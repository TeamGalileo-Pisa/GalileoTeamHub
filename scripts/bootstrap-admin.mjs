import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile ${name} mancante`);
  return value;
}

function normalizeUsername(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

const url = required("VITE_SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const password = required("BOOTSTRAP_ADMIN_PASSWORD");
const domain = process.env.VITE_AUTH_EMAIL_DOMAIN?.trim() || "auth.teamgalileo.local";
const username = normalizeUsername(
  process.env.BOOTSTRAP_ADMIN_USERNAME || "Amministrazione",
);
const displayName =
  process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || "Amministrazione";

if (password.length < 12) {
  throw new Error("La password iniziale deve contenere almeno 12 caratteri");
}

const client = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `${username}@${domain}`;
let userId;

const { data: usersPage, error: listError } =
  await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;

const existing = usersPage.users.find(
  (user) => user.email?.toLowerCase() === email.toLowerCase(),
);

if (existing) {
  userId = existing.id;
} else {
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName },
  });
  if (error || !data.user) throw error || new Error("Creazione utente fallita");
  userId = data.user.id;
}

const { error: profileError } = await client.from("profiles").upsert({
  id: userId,
  username,
  display_name: displayName,
  status: "active",
  must_change_password: true,
});
if (profileError) throw profileError;

const { error: roleError } = await client.from("system_roles").upsert({
  user_id: userId,
  role: "admin",
});
if (roleError) throw roleError;

process.stdout.write(
  `Account amministrativo pronto: ${username} (${userId})\n` +
    "La password non è stata stampata né salvata nel repository.\n",
);

