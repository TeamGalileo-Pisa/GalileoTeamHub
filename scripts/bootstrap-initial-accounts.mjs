import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_AUTH_EMAIL_DOMAIN,
  INITIAL_ACCOUNTS,
  usernameToInternalEmail,
} from "./initial-accounts.mjs";

const loadedSecrets = [];

function requiredEnvironmentVariable(name, { secret = false } = {}) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  if (secret) loadedSecrets.push(value);
  return value;
}

function validateInitialPassword(name, password) {
  const valid =
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);

  if (!valid) {
    throw new Error(
      `La variabile ${name} non rispetta i requisiti della password iniziale`,
    );
  }
}

function loadConfiguration() {
  const url = requiredEnvironmentVariable("SUPABASE_URL");
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error(
      "Variabile d'ambiente mancante: SUPABASE_SECRET_KEY " +
        "(oppure SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  loadedSecrets.push(serviceRoleKey);
  const authEmailDomain =
    process.env.AUTH_EMAIL_DOMAIN?.trim() || DEFAULT_AUTH_EMAIL_DOMAIN;
  const passwords = new Map();

  for (const account of INITIAL_ACCOUNTS) {
    const password = requiredEnvironmentVariable(
      account.passwordEnvironmentVariable,
      { secret: true },
    );
    validateInitialPassword(account.passwordEnvironmentVariable, password);
    passwords.set(account.passwordEnvironmentVariable, password);
    usernameToInternalEmail(account.username, authEmailDomain);
  }

  return { url, serviceRoleKey, authEmailDomain, passwords };
}

function errorMessage(error) {
  let message = error instanceof Error ? error.message : "Errore inatteso";
  for (const secret of loadedSecrets) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message;
}

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function listAllAuthUsers(client) {
  const users = [];
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    assertNoError(error, "Impossibile leggere gli utenti Auth");
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }

  return users;
}

async function loadBootstrapState(client) {
  const [authUsers, profilesResult, areasResult] = await Promise.all([
    listAllAuthUsers(client),
    client
      .from("profiles")
      .select("id, username, display_name, status, must_change_password"),
    client.from("areas").select("id, name, active"),
  ]);

  assertNoError(profilesResult.error, "Impossibile leggere i profili");
  assertNoError(areasResult.error, "Impossibile leggere le aree");

  const usersById = new Map(authUsers.map((user) => [user.id, user]));
  const usersByEmail = new Map(
    authUsers
      .filter((user) => user.email)
      .map((user) => [user.email.toLowerCase(), user]),
  );
  const profilesByUsername = new Map(
    profilesResult.data.map((profile) => [
      profile.username.toLocaleLowerCase("it-IT"),
      profile,
    ]),
  );
  const areasByName = new Map(
    areasResult.data.map((area) => [
      area.name.toLocaleLowerCase("it-IT"),
      area,
    ]),
  );

  for (const account of INITIAL_ACCOUNTS) {
    if (account.role !== "area_lead") continue;
    const area = areasByName.get(account.area.toLocaleLowerCase("it-IT"));
    if (!area || !area.active) {
      throw new Error(`Area attiva non trovata: ${account.area}`);
    }
  }

  return { usersById, usersByEmail, profilesByUsername, areasByName };
}

async function reconcileAuthUser(client, state, account, configuration) {
  const expectedEmail = usernameToInternalEmail(
    account.username,
    configuration.authEmailDomain,
  );
  const existingProfile = state.profilesByUsername.get(
    account.username.toLocaleLowerCase("it-IT"),
  );
  const userByEmail = state.usersByEmail.get(expectedEmail);
  const userByProfile = existingProfile
    ? state.usersById.get(existingProfile.id)
    : undefined;

  if (userByEmail && userByProfile && userByEmail.id !== userByProfile.id) {
    throw new Error(`Conflitto tra Auth e profilo per ${account.username}`);
  }

  let user = userByEmail ?? userByProfile;
  let created = false;
  const previousEmail = user?.email?.toLowerCase();

  if (!user) {
    const password = configuration.passwords.get(
      account.passwordEnvironmentVariable,
    );
    const { data, error } = await client.auth.admin.createUser({
      email: expectedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username: account.username,
        display_name: account.displayName,
      },
    });
    assertNoError(error, `Creazione Auth fallita per ${account.username}`);
    if (!data.user) {
      throw new Error(`Utente Auth non restituito per ${account.username}`);
    }
    user = data.user;
    created = true;
  } else {
    const attributes = {
      email_confirm: true,
      user_metadata: {
        ...user.user_metadata,
        username: account.username,
        display_name: account.displayName,
      },
    };
    attributes.password = configuration.passwords.get(
      account.passwordEnvironmentVariable,
    );
    if (user.email?.toLowerCase() !== expectedEmail) {
      attributes.email = expectedEmail;
    }

    const { data, error } = await client.auth.admin.updateUserById(
      user.id,
      attributes,
    );
    assertNoError(error, `Aggiornamento Auth fallito per ${account.username}`);
    if (!data.user) {
      throw new Error(`Utente Auth non restituito per ${account.username}`);
    }
    user = data.user;
  }

  if (previousEmail && previousEmail !== expectedEmail) {
    state.usersByEmail.delete(previousEmail);
  }
  state.usersById.set(user.id, user);
  state.usersByEmail.set(expectedEmail, user);
  return { user, created, existingProfile };
}

async function reconcileProfile(client, account, authState) {
  const { error } = await client.from("profiles").upsert({
    id: authState.user.id,
    username: account.username,
    display_name: account.displayName,
    status: "active",
    must_change_password: true,
  });
  assertNoError(error, `Aggiornamento profilo fallito per ${account.username}`);
}

async function endActiveMemberships(client, userId, exceptAreaId) {
  let query = client
    .from("area_memberships")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("ended_at", null);
  if (exceptAreaId) query = query.neq("area_id", exceptAreaId);
  const { error } = await query;
  assertNoError(error, "Chiusura associazioni area non valide fallita");
}

async function reconcileAuthorization(client, state, account, userId, adminId) {
  if (account.role === "admin") {
    await endActiveMemberships(client, userId);
    const { error } = await client.from("system_roles").upsert(
      { user_id: userId, role: "admin", granted_by: userId },
      { onConflict: "user_id,role" },
    );
    assertNoError(error, "Assegnazione ruolo amministrativo fallita");
    return;
  }

  const area = state.areasByName.get(account.area.toLocaleLowerCase("it-IT"));
  const { error: roleDeleteError } = await client
    .from("system_roles")
    .delete()
    .eq("user_id", userId);
  assertNoError(roleDeleteError, "Rimozione ruolo globale non valido fallita");

  await endActiveMemberships(client, userId, area.id);

  const { data: membership, error: membershipError } = await client
    .from("area_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("area_id", area.id)
    .eq("role", "area_lead")
    .is("ended_at", null)
    .maybeSingle();
  assertNoError(membershipError, "Verifica associazione area fallita");

  if (!membership) {
    const { error } = await client.from("area_memberships").insert({
      user_id: userId,
      area_id: area.id,
      role: "area_lead",
      created_by: adminId,
    });
    assertNoError(error, `Associazione all'area ${account.area} fallita`);
  }
}

async function verifyAccount(
  client,
  state,
  account,
  user,
  authEmailDomain,
  expectedMustChangePassword,
) {
  const expectedEmail = usernameToInternalEmail(
    account.username,
    authEmailDomain,
  );
  if (user.email?.toLowerCase() !== expectedEmail || !user.email_confirmed_at) {
    throw new Error(`Verifica Auth fallita per ${account.username}`);
  }

  const [profileResult, rolesResult, membershipsResult] = await Promise.all([
    client
      .from("profiles")
      .select("username, display_name, status, must_change_password")
      .eq("id", user.id)
      .single(),
    client.from("system_roles").select("role").eq("user_id", user.id),
    client
      .from("area_memberships")
      .select("area_id, role")
      .eq("user_id", user.id)
      .is("ended_at", null),
  ]);
  assertNoError(profileResult.error, "Verifica profilo fallita");
  assertNoError(rolesResult.error, "Verifica ruolo globale fallita");
  assertNoError(membershipsResult.error, "Verifica associazione area fallita");

  const profile = profileResult.data;
  if (
    profile.username !== account.username ||
    profile.display_name !== account.displayName ||
    profile.status !== "active" ||
    profile.must_change_password !== expectedMustChangePassword
  ) {
    throw new Error(`Profilo non conforme per ${account.username}`);
  }

  if (account.role === "admin") {
    if (
      rolesResult.data.length !== 1 ||
      rolesResult.data[0].role !== "admin" ||
      membershipsResult.data.length !== 0
    ) {
      throw new Error("Autorizzazioni amministrative non conformi");
    }
    return;
  }

  const expectedArea = state.areasByName.get(
    account.area.toLocaleLowerCase("it-IT"),
  );
  if (
    rolesResult.data.length !== 0 ||
    membershipsResult.data.length !== 1 ||
    membershipsResult.data[0].role !== "area_lead" ||
    membershipsResult.data[0].area_id !== expectedArea.id
  ) {
    throw new Error(`Autorizzazioni area non conformi per ${account.username}`);
  }
}

async function main() {
  const configuration = loadConfiguration();
  const client = createClient(configuration.url, configuration.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const state = await loadBootstrapState(client);
  const completedAccounts = [];
  let adminId;

  for (const account of INITIAL_ACCOUNTS) {
    const authState = await reconcileAuthUser(
      client,
      state,
      account,
      configuration,
    );

    try {
      await reconcileProfile(client, account, authState);
      if (account.role === "admin") adminId = authState.user.id;
      await reconcileAuthorization(
        client,
        state,
        account,
        authState.user.id,
        adminId,
      );
      await verifyAccount(
        client,
        state,
        account,
        authState.user,
        configuration.authEmailDomain,
        true,
      );
    } catch (error) {
      if (authState.created) {
        await client.auth.admin.deleteUser(authState.user.id);
      }
      throw error;
    }

    completedAccounts.push(account.username);
  }

  process.stdout.write(
    completedAccounts.map((username) => `${username}: OK`).join("\n") + "\n",
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Bootstrap non completato: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
