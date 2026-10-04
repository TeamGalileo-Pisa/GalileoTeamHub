export const divisions: Record<
  string,
  { title: string; question: string; skills: string[] }
> = {
  geologia: {
    title: "Geologia & Scienze della Terra",
    question:
      "Quali attività o strumenti conosci o hai già approcciato nei tuoi studi?",
    skills: [
      "Sistemi GIS / Cartografia digitale (QGIS, ArcGIS, ecc.)",
      "Analisi stratigrafica e sedimentologica",
      "Mineralogia e riconoscimento macroscopico delle rocce",
      "Fotogrammetria o telerilevamento",
      "Nessuna opzione",
      "Altro",
    ],
  },
  biologia: {
    title: "Biologia & Biotecnologie",
    question:
      "Quali sono le tue principali aree di interesse o competenze pratiche?",
    skills: [
      "Tecniche di laboratorio chimico/biologico (es. saggi colorimetrici, microfluidica)",
      "Biosensori e sistemi di immunodiagnostica / biomarker",
      "Microbiologia degli ambienti estremi (Astrobiologia)",
      "Spettrometria o analisi strumentale chimica",
      "Altro",
    ],
  },
  agraria: {
    title: "Scienze Agrarie & Affini",
    question:
      "Su quali tematiche ti piacerebbe focalizzarti all'interno del team?",
    skills: [
      "Analisi chimico-fisica del suolo e dei nutrienti",
      "Sistemi idroponici / aeroponici o colture in ambienti controllati",
      "Sviluppo di substrati sintetici o regoliti simulati",
      "Sistemi biologici di supporto vitale rigenerativo (BLSS)",
      "Altro",
    ],
  },
  rover: {
    title: "Mobility & Structural Design",
    question:
      "Quali software o competenze tecniche possiedi nell'ambito della progettazione meccanica?",
    skills: [
      "Modellazione CAD (SolidWorks, Autodesk Fusion 360, Inventor, ecc.)",
      "Analisi FEM / Strutturale (Ansys, SolidWorks Simulation, ecc.)",
      "Lavorazioni meccaniche, scelta dei materiali o Stampa 3D (Slicing)",
      "Cinematica e dinamica dei sistemi articolati (es. braccio robotico)",
      "Altro",
    ],
  },
  braccio: {
    title: "Manipulation & Robotics",
    question:
      "Quali software o competenze tecniche possiedi nell'ambito della progettazione meccanica?",
    skills: [
      "Modellazione CAD (SolidWorks, Autodesk Fusion 360, Inventor, ecc.)",
      "Analisi FEM / Strutturale (Ansys, SolidWorks Simulation, ecc.)",
      "Lavorazioni meccaniche, scelta dei materiali o Stampa 3D (Slicing)",
      "Cinematica e dinamica dei sistemi articolati (es. braccio robotico)",
      "Altro",
    ],
  },
  elettronica: {
    title: "Electronics, RF & Power",
    question:
      "Quali sono le tue competenze attuali nel campo dell'hardware ed elettronica?",
    skills: [
      "Sviluppo, progettazione e saldatura a stagno di PCB custom (Altium, KiCAD, Eagle, ecc.), anche con microcontrollori (STM32, ESP32)",
      "Dimensionamento di sistemi di alimentazione (Batterie, BMS, convertitori DC/DC)",
      "Sistemi a radiofrequenza (RF), antenne e protocolli di comunicazione radio",
      "Analisi della sensoristica: carichi, efficienza e schede di supporto",
      "Altro",
    ],
  },
  software: {
    title: "Software, Controls & Navigation",
    question: "Con quali linguaggi, framework o sistemi hai già lavorato?",
    skills: [
      "Linguaggi di programmazione: Python o C++",
      "Ambiente Linux (Ubuntu) e utilizzo del Terminale / Git",
      "ROS2 (Robot Operating System)",
      "Computer Vision (OpenCV, YOLO, algoritmi di segmentazione)",
      "Algoritmi di navigazione autonoma, SLAM e controllo predittivo",
      "Nessuna opzione",
      "Altro",
    ],
  },
  business: {
    title: "Business & Project Management",
    question:
      "In quali di queste attività pensi di poter dare il contributo maggiore?",
    skills: [
      "Redazione di Modelli Economici, Business Plan e proiezioni per la gara",
      "Costruzione delle BOM (Bill of Materials) e gestione dei costi industriali del rover",
      "Project Management, definizione delle Milestone e gestione generale della timeline (in accordo con il Team Leader)",
      "Gestione della contabilità interna e allocazione dei fondi sui vari reparti tecnici",
      "Altro",
    ],
  },
  comunicazione: {
    title: "Comunicazione & Media",
    question: "Su quali strumenti o canali sai gestire con maggiore fluidità?",
    skills: [
      "Grafica pubblicitaria, Branding e creazione di loghi/stemmi del Team (Canva, Photoshop, Illustrator)",
      "Social Media Management (Pianificazione piani editoriali, copywriting per Instagram, X, TikTok, LinkedIn)",
      "Realizzazione e ottimizzazione del Sito Web del Team",
      "Video Making e Video Editing professionali (Riprese sul campo, montaggio con Premiere, DaVinci, CapCut)",
      "Realizzazione foto e photo editing (Conoscenza dei set nel background dei rover)",
      "Realizzazione di Contenuti Specifici e campagne di marketing legati agli obblighi dei contratti stipulati con le aziende partner",
      "Altro",
    ],
  },
  logistica: {
    title: "Logistica & Sponsor Technical Scouting",
    question:
      "Su quali aspetti gestionali e logistici ti piacerebbe dare il tuo contributo?",
    skills: [
      "Sponsor Technical Scouting & Contratti: ricerca di aziende partner manifatturiere e negoziazione di accordi in-kind per componenti del rover",
      "Magazzino, Logistica & Sicurezza: inventario digitale dell'hardware, organizzazione fisica dei laboratori e dei protocolli di sicurezza",
      "Pianificazione Spostamenti & Trasferte: organizzazione logistica dei test sul campo a Pisa e della spedizione del rover/equipe per la gara ERC in Polonia",
      "Gestione Acquisti & Burocrazia: interfacciamento con i sistemi universitari, gestione pratica degli ordini tecnici e sblocco dei crediti",
      "Recruitment, HR & Onboarding: gestione del flusso dei nuovi candidati, accoglienza nel team e monitoraggio della coesione interna",
      "Altro",
    ],
  },
};
export const applicationChoices = {
  year: [
    "1 anno TRIENNALE",
    "2 anno TRIENNALE",
    "3 anno TRIENNALE",
    "anno successivo al 3 anno TRIENNALE",
    "1 anno MAGISTRALE",
    "2 anno MAGISTRALE",
    "anno successivo al 2 anno MAGISTRALE",
  ],
  level: [
    "Principiante / Voglio imparare",
    "Intermedio: ho già fatto piccoli progetti personali, esami pratici o tesi",
    "Avanzato: ho un'ottima padronanza pratica e posso muovermi in autonomia",
  ],
  leadership: [
    "Sì, sono molto interessato/a a ricoprire un ruolo di responsabilità e coordinamento",
    "Valutiamo insieme: fermo prima capire meglio l'impegno richiesto",
    "No, preferisco un ruolo esclusivamente operativo/tecnico all'interno dell'area",
  ],
  availability: [
    "Sempre a disposizione / Massima flessibilità",
    "Presenza costante e regolare",
    "Disponibilità a chiamata / All'occorrenza",
    "Dipende dalla fase dell'anno",
  ],
  presence: [
    "Sono sempre a Pisa",
    "3-4 giorni a settimana",
    "Solo sporadicamente",
  ],
  deadlines: [
    "Tendo a organizzarmi in anticipo pianificando gli obiettivi settimana per settimana",
    "Do il meglio sotto pressione, concentrando il lavoro a ridosso delle scadenze",
    "Faccio fatica a gestire troppi impegni insieme e preferisco compiti dilazionati nel tempo",
  ],
  problemSolving: [
    "Studio la documentazione ufficiale, cerco online e guardo tutorial per risolverlo in autonomia",
    "Chiedo immediatamente supporto al mio Capo Area o ai compagni di team",
    "Propongo di aggirare il problema cambiando approccio o provando una strada completamente diversa",
  ],
};
export const certifications = [
  "Ottimo livello di Inglese scritto/parlato (B2, C1, C2 o madrelingua)",
  "Certificazioni CAD / Programmazione (es. CSWA/CSWP per SolidWorks, certificazioni Python/Linux)",
  "Patentino per l'uso dei droni",
  "Competenze di amministrazione/contabilità (es. gestione tesoreria di associazioni)",
  "Nessuna di queste, ma ottima predisposizione a imparare",
  "Altro",
];

export const genericDivision = {
  title: "Area",
  question: "Quali sono le tue competenze e i tuoi interessi per questa area?",
  skills: ["Altro"],
};

