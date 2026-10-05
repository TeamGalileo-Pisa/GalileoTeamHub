export type ApplicationAreaInfo = {
  summary: string;
  activities: string[];
};

// Descriptions adapted from the public Team Galileo information page.
export const applicationAreaInfo: Record<string, ApplicationAreaInfo> = {
  geologia: {
    summary: "Studia il suolo e il contesto geologico in cui il rover dovrà operare.",
    activities: [
      "Analisi morfologica del suolo e mappatura stratigrafica.",
      "Modellazione 3D della regolite.",
      "Selezione scientifica dei possibili siti di atterraggio del rover.",
    ],
  },
  biologia: {
    summary: "Si occupa di ricerca biologica e di strumenti per individuare possibili tracce di vita.",
    activities: [
      "Ricerca di biomarcatori per protocolli di rilevamento della vita extraterrestre.",
      "Configurazione dei reagenti.",
      "Sviluppo e test di biosensori da utilizzare a bordo.",
    ],
  },
  agraria: {
    summary: "Esplora le proprietà dei terreni e possibili sistemi biologici di supporto alla vita.",
    activities: [
      "Studio delle proprietà chimico-fisiche dei substrati extraterrestri.",
      "Ricerca di soluzioni bio-rigenerative per il supporto vitale.",
    ],
  },
  rover: {
    summary: "Progetta la struttura e la mobilità del rover per affrontare terreni difficili.",
    activities: [
      "Progettazione meccanica dello chassis, delle sospensioni e dei sistemi di trazione.",
      "Analisi strutturale (FEM) e scelta di materiali leggeri.",
    ],
  },
  braccio: {
    summary: "Progetta il braccio robotico e i suoi strumenti per manipolare oggetti con precisione.",
    activities: [
      "Progettazione e controllo cinematico del braccio e degli end-effector.",
      "Sviluppo di funzioni per task di precisione, manutenzione e interazione con pannelli operativi.",
    ],
  },
  elettronica: {
    summary: "Realizza l’elettronica, l’alimentazione e le comunicazioni del rover.",
    activities: [
      "Sviluppo dei sistemi di alimentazione e distribuzione della potenza.",
      "Progettazione di schede PCB personalizzate.",
      "Gestione dei moduli di comunicazione radio a lungo raggio.",
    ],
  },
  software: {
    summary: "Sviluppa il software che permette al rover di percepire l’ambiente e muoversi.",
    activities: [
      "Sviluppo in ambiente ROS2.",
      "Computer vision per il riconoscimento degli ostacoli.",
      "Algoritmi di navigazione autonoma e interfacce grafiche per la teleoperazione.",
    ],
  },
  logistica: {
    summary: "Fa funzionare l’organizzazione pratica del team, dei materiali e delle trasferte, e supporta sponsor e recruitment.",
    activities: [
      "Ricerca di sponsor, gestione dei contatti aziendali, contratti e acquisti operativi.",
      "Organizzazione del magazzino, tracciamento dei materiali e supporto alle attività in officina.",
      "Pianificazione di fiere e trasferte, recruitment e inserimento dei nuovi membri.",
    ],
  },
  business: {
    summary: "Cura la pianificazione economica e il coordinamento gestionale del progetto.",
    activities: [
      "Gestione della contabilità, controllo delle risorse e assegnazione dei fondi alle aree.",
      "Preparazione dei modelli economici di gara, delle BOM e dei Business Model annuali.",
      "Definizione delle milestone e coordinamento del progetto insieme al Team Leader.",
    ],
  },
  comunicazione: {
    summary: "Racconta il progetto e cura l’identità e i contenuti pubblici del team.",
    activities: [
      "Gestione dei canali social del team.",
      "Realizzazione del sito, dei contenuti foto e video e del loro montaggio.",
      "Creazione di contenuti per gli sponsor, loghi, stemmi e materiali coordinati.",
    ],
  },
};
