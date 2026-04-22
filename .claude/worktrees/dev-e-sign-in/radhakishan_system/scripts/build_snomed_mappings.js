#!/usr/bin/env node
/**
 * Build SNOMED-CT diagnosis mappings for all standard_prescriptions.
 * Reads _temp_rows.json (extracted from DB query) and produces
 * radhakishan_system/data/snomed_diagnosis_mappings.json
 *
 * ICD-10 to SNOMED-CT mappings based on WHO/NLM crosswalk + clinical knowledge.
 * For unclear mappings, snomed_code and snomed_display are null.
 */

const fs = require("fs");
const path = require("path");

const rows = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "_temp_rows.json"), "utf8"),
);

// Comprehensive ICD-10 → SNOMED-CT mapping table
// Format: icd10_prefix → { code, display }
// We match most specific first, then fall back to broader codes
const ICD10_TO_SNOMED = {
  // Infectious diseases (A00-B99)
  A01: { code: "4834000", display: "Typhoid fever" },
  "A01.0": { code: "4834000", display: "Typhoid fever" },
  A03: { code: "36188001", display: "Shigellosis" },
  A04: { code: "42338000", display: "Bacterial intestinal infection" },
  A06: { code: "32488009", display: "Amoebiasis" },
  A07: { code: "51526001", display: "Protozoal intestinal disease" },
  "A08.4": { code: "64532007", display: "Viral intestinal infection" },
  A09: { code: "25374005", display: "Gastroenteritis" },
  A15: { code: "154283005", display: "Pulmonary tuberculosis" },
  A16: { code: "154283005", display: "Pulmonary tuberculosis" },
  A17: { code: "56335008", display: "Tuberculosis of nervous system" },
  A18: { code: "399059003", display: "Tuberculosis of other organs" },
  A19: { code: "30850004", display: "Miliary tuberculosis" },
  A27: { code: "77377001", display: "Leptospirosis" },
  A33: { code: "84005002", display: "Neonatal tetanus" },
  A36: { code: "397428000", display: "Diphtheria" },
  A37: { code: "27836007", display: "Pertussis" },
  A38: { code: "30242009", display: "Scarlet fever" },
  A39: { code: "4089001", display: "Meningococcal infection" },
  A40: { code: "448417001", display: "Streptococcal sepsis" },
  A41: { code: "10001005", display: "Bacterial sepsis" },
  "A41.9": { code: "91302008", display: "Sepsis" },
  "A49.9": { code: "87628006", display: "Bacterial infectious disease" },
  "A75.3": { code: "75702008", display: "Scrub typhus" },
  A82: { code: "14168008", display: "Rabies" },
  A87: { code: "58170007", display: "Viral meningitis" },
  A90: { code: "38362002", display: "Dengue fever" },
  A91: { code: "20927009", display: "Dengue hemorrhagic fever" },
  "A92.0": { code: "111864006", display: "Chikungunya fever" },
  B00: { code: "88594005", display: "Herpes simplex infection" },
  B01: { code: "38907003", display: "Varicella" },
  "B01.9": { code: "38907003", display: "Varicella" },
  B02: { code: "4740000", display: "Herpes zoster" },
  B05: { code: "14189004", display: "Measles" },
  "B05.9": { code: "14189004", display: "Measles" },
  B06: { code: "36653000", display: "Rubella" },
  "B08.2": { code: "240523007", display: "Exanthem subitum" },
  "B08.4": { code: "266104004", display: "Hand, foot and mouth disease" },
  B15: { code: "40468003", display: "Viral hepatitis A" },
  B16: { code: "66071002", display: "Viral hepatitis B" },
  "B17.1": { code: "50711007", display: "Viral hepatitis C" },
  B20: { code: "86406008", display: "Human immunodeficiency virus infection" },
  B25: { code: "28944009", display: "Cytomegalovirus infection" },
  B26: { code: "36989005", display: "Mumps" },
  B27: { code: "271558008", display: "Infectious mononucleosis" },
  "B34.9": { code: "34014006", display: "Viral disease" },
  B35: { code: "47382004", display: "Dermatophytosis" },
  "B35.9": { code: "47382004", display: "Dermatophytosis" },
  B36: { code: "3218000", display: "Mycosis" },
  B37: { code: "78048006", display: "Candidiasis" },
  "B37.2": { code: "426433000", display: "Candidiasis of skin" },
  B50: { code: "61462000", display: "Malaria" },
  "B50.9": { code: "61462000", display: "Malaria" },
  B51: { code: "41333006", display: "Plasmodium vivax malaria" },
  B54: { code: "61462000", display: "Malaria" },
  B76: { code: "84619001", display: "Hookworm disease" },
  B77: { code: "2435008", display: "Ascariasis" },
  B80: { code: "266147009", display: "Enterobiasis" },
  B81: { code: "27601005", display: "Helminthiasis" },
  "B82.9": { code: "105629000", display: "Intestinal parasitic disease" },
  B85: { code: "81000006", display: "Pediculosis" },
  B86: { code: "128869009", display: "Scabies" },

  // Neoplasms (C00-D48)
  C41: { code: "93725002", display: "Malignant neoplasm of bone" },
  C49: {
    code: "399981008",
    display: "Malignant neoplasm of connective tissue",
  },
  C64: { code: "93849006", display: "Malignant neoplasm of kidney" },
  C71: { code: "428061005", display: "Malignant neoplasm of brain" },
  C81: { code: "118599009", display: "Hodgkin lymphoma" },
  C85: { code: "118601006", display: "Non-Hodgkin lymphoma" },
  "C91.0": { code: "91857003", display: "Acute lymphoblastic leukemia" },
  "C92.0": { code: "91861009", display: "Acute myeloid leukemia" },

  // Blood diseases (D50-D89)
  D50: { code: "87522002", display: "Iron deficiency anemia" },
  "D50.9": { code: "87522002", display: "Iron deficiency anemia" },
  D51: { code: "190606006", display: "Vitamin B12 deficiency anemia" },
  D52: { code: "413348000", display: "Folate deficiency anemia" },
  D53: { code: "267521007", display: "Nutritional anemia" },
  D56: { code: "40108008", display: "Thalassemia" },
  D57: { code: "417357006", display: "Sickle cell disease" },
  D58: { code: "61261009", display: "Hereditary hemolytic anemia" },
  D59: { code: "61261009", display: "Hemolytic anemia" },
  D61: { code: "306058006", display: "Aplastic anemia" },
  "D61.8": { code: "127034005", display: "Pancytopenia" },
  D64: { code: "271737000", display: "Anemia" },
  D66: { code: "28293008", display: "Hemophilia A" },
  D67: { code: "1563006", display: "Hemophilia B" },
  D68: { code: "64779008", display: "Coagulation disorder" },
  "D69.0": { code: "191306005", display: "Henoch-Schonlein purpura" },
  "D69.6": { code: "302215000", display: "Thrombocytopenia" },
  D70: { code: "165517008", display: "Neutropenia" },
  D80: {
    code: "234532001",
    display: "Immunodeficiency with predominantly antibody defects",
  },
  D81: { code: "31323000", display: "Severe combined immunodeficiency" },
  D82: {
    code: "234645009",
    display: "Immunodeficiency associated with other major defects",
  },
  D83: { code: "234416002", display: "Common variable immunodeficiency" },
  D84: { code: "234532001", display: "Immunodeficiency disorder" },

  // Endocrine (E00-E90)
  "E03.9": { code: "40930008", display: "Hypothyroidism" },
  E05: { code: "34486009", display: "Hyperthyroidism" },
  "E10.1": { code: "421750000", display: "Diabetic ketoacidosis" },
  "E10.9": { code: "46635009", display: "Type 1 diabetes mellitus" },
  "E16.2": { code: "302866003", display: "Hypoglycemia" },
  "E25.0": { code: "237751000", display: "Congenital adrenal hyperplasia" },
  "E27.4": { code: "386584007", display: "Adrenal insufficiency" },
  "E30.1": { code: "400179000", display: "Precocious puberty" },
  "E30.9": { code: "400179000", display: "Disorder of puberty" },
  "E34.3": { code: "237837007", display: "Short stature" },
  E43: { code: "238107002", display: "Severe protein-energy malnutrition" },
  E44: { code: "238106006", display: "Moderate protein-energy malnutrition" },
  E46: { code: "248325000", display: "Malnutrition" },
  E50: { code: "72000004", display: "Vitamin A deficiency" },
  E55: { code: "34713006", display: "Vitamin D deficiency" },
  E56: { code: "85670002", display: "Vitamin deficiency" },
  E66: { code: "414916001", display: "Obesity" },
  "E70.0": { code: "7573000", display: "Phenylketonuria" },
  E71: {
    code: "363205009",
    display: "Disorder of branched-chain amino acid metabolism",
  },
  E72: { code: "52767006", display: "Disorder of amino acid metabolism" },
  E74: { code: "20957000", display: "Disorder of carbohydrate metabolism" },
  E75: { code: "23585005", display: "Lipid storage disease" },
  "E76.0": { code: "82525005", display: "Mucopolysaccharidosis" },
  E84: { code: "190905008", display: "Cystic fibrosis" },
  E86: { code: "34095006", display: "Dehydration" },
  "E87.1": { code: "267447008", display: "Disorder of sodium metabolism" },
  "E87.2": { code: "59455009", display: "Metabolic acidosis" },
  "E87.5": { code: "14140009", display: "Hyperkalemia" },
  E88: { code: "75934005", display: "Metabolic disease" },

  // Mental/Behavioral (F00-F99)
  F51: { code: "39898005", display: "Sleep disorder" },
  F70: { code: "86765009", display: "Mild intellectual disability" },
  F71: { code: "6471006", display: "Moderate intellectual disability" },
  F80: {
    code: "62415009",
    display: "Specific developmental disorder of speech and language",
  },
  F81: { code: "1855002", display: "Developmental learning disorder" },
  F82: { code: "43153001", display: "Developmental coordination disorder" },
  F84: { code: "35919005", display: "Autism spectrum disorder" },
  "F90.9": {
    code: "406506008",
    display: "Attention deficit hyperactivity disorder",
  },
  F91: { code: "9406002", display: "Conduct disorder" },
  F93: { code: "109006", display: "Anxiety disorder of childhood" },
  F94: {
    code: "109006",
    display: "Disorder of social functioning of childhood",
  },
  F95: { code: "44913001", display: "Tic disorder" },
  "F98.0": { code: "8009008", display: "Nocturnal enuresis" },
  "F98.1": { code: "302751004", display: "Encopresis" },

  // Nervous system (G00-G99)
  G00: { code: "95883001", display: "Bacterial meningitis" },
  G03: { code: "7180009", display: "Meningitis" },
  G04: { code: "45170000", display: "Encephalitis" },
  G06: { code: "441806004", display: "Intracranial abscess" },
  G24: { code: "15802004", display: "Dystonia" },
  G25: { code: "267080003", display: "Movement disorder" },
  G40: { code: "84757009", display: "Epilepsy" },
  "G40.9": { code: "84757009", display: "Epilepsy" },
  G41: { code: "230456007", display: "Status epilepticus" },
  G43: { code: "37796009", display: "Migraine" },
  "G47.3": { code: "78275009", display: "Obstructive sleep apnea syndrome" },
  "G47.9": { code: "39898005", display: "Sleep disorder" },
  "G61.0": { code: "193174005", display: "Guillain-Barre syndrome" },
  G70: { code: "91637004", display: "Myasthenia gravis" },
  G71: { code: "129565002", display: "Myopathy" },
  G72: { code: "129565002", display: "Myopathy" },
  G80: { code: "128188000", display: "Cerebral palsy" },
  G81: { code: "50582007", display: "Hemiplegia" },
  G91: { code: "55999004", display: "Hydrocephalus" },
  "G93.1": { code: "419530002", display: "Anoxic brain damage" },
  "G93.2": { code: "68267002", display: "Benign intracranial hypertension" },
  "G93.4": { code: "81308009", display: "Encephalopathy" },

  // Eye (H00-H59)
  H04: { code: "128462006", display: "Disorder of lacrimal system" },
  H10: { code: "9826008", display: "Conjunctivitis" },
  H16: { code: "5888003", display: "Keratitis" },
  H50: { code: "22066006", display: "Strabismus" },
  H52: { code: "39021009", display: "Refractive error" },
  H53: { code: "63102001", display: "Visual disturbance" },
  H54: { code: "397540003", display: "Visual impairment" },

  // Ear (H60-H95)
  H60: { code: "3135009", display: "Otitis externa" },
  "H61.2": { code: "68381005", display: "Impacted cerumen" },
  H65: { code: "65363002", display: "Otitis media" },
  H66: { code: "65363002", display: "Otitis media" },
  "H66.9": { code: "65363002", display: "Otitis media" },
  "H66.90": { code: "3110003", display: "Acute otitis media" },
  H72: { code: "60442001", display: "Tympanic membrane perforation" },
  H90: { code: "15188001", display: "Hearing loss" },
  H91: { code: "15188001", display: "Hearing loss" },

  // Circulatory (I00-I99)
  I00: { code: "58718002", display: "Acute rheumatic fever" },
  I05: { code: "48724000", display: "Rheumatic mitral valve disease" },
  I10: { code: "38341003", display: "Hypertension" },
  "I27.2": { code: "70995007", display: "Pulmonary hypertension" },
  I30: { code: "3238004", display: "Pericarditis" },
  I38: { code: "56819008", display: "Endocarditis" },
  I40: { code: "50920009", display: "Myocarditis" },
  I42: { code: "85898001", display: "Cardiomyopathy" },
  I47: { code: "6456007", display: "Supraventricular tachycardia" },
  "I49.9": { code: "698247007", display: "Cardiac arrhythmia" },
  I50: { code: "84114007", display: "Heart failure" },

  // Respiratory (J00-J99)
  J00: { code: "82272006", display: "Common cold" },
  J01: { code: "15805002", display: "Acute sinusitis" },
  J02: { code: "405737000", display: "Pharyngitis" },
  "J02.0": { code: "43878008", display: "Streptococcal pharyngitis" },
  "J02.9": { code: "405737000", display: "Pharyngitis" },
  J03: { code: "90176007", display: "Tonsillitis" },
  "J03.9": { code: "90176007", display: "Tonsillitis" },
  J04: { code: "6969002", display: "Acute laryngitis" },
  "J04.0": { code: "6969002", display: "Acute laryngitis" },
  "J05.0": { code: "6142004", display: "Croup" },
  "J06.9": { code: "54150009", display: "Upper respiratory infection" },
  J10: { code: "6142004", display: "Influenza" },
  J11: { code: "6142004", display: "Influenza" },
  J10: {
    code: "442696006",
    display: "Influenza due to identified influenza virus",
  },
  J11: { code: "6142004", display: "Influenza" },
  J12: { code: "75570004", display: "Viral pneumonia" },
  J13: { code: "233607000", display: "Pneumococcal pneumonia" },
  J14: {
    code: "195878008",
    display: "Pneumonia caused by Haemophilus influenzae",
  },
  "J15.9": { code: "53084003", display: "Bacterial pneumonia" },
  "J18.9": { code: "233604007", display: "Pneumonia" },
  J20: { code: "10509002", display: "Acute bronchitis" },
  "J20.9": { code: "10509002", display: "Acute bronchitis" },
  J21: { code: "4120002", display: "Bronchiolitis" },
  "J21.0": { code: "4120002", display: "Bronchiolitis" },
  "J21.9": { code: "4120002", display: "Bronchiolitis" },
  J22: { code: "50417007", display: "Lower respiratory tract infection" },
  "J30.9": { code: "61582004", display: "Allergic rhinitis" },
  J32: { code: "40055000", display: "Chronic sinusitis" },
  J35: { code: "441491005", display: "Chronic tonsillar disease" },
  "J35.1": { code: "38462009", display: "Hypertrophy of tonsils" },
  "J35.2": { code: "38462009", display: "Hypertrophy of adenoids" },
  J45: { code: "195967001", display: "Asthma" },
  "J45.9": { code: "195967001", display: "Asthma" },
  "J45.901": { code: "195967001", display: "Asthma" },
  J46: { code: "31387002", display: "Status asthmaticus" },
  J80: { code: "67782005", display: "Acute respiratory distress syndrome" },
  J85: { code: "41381004", display: "Lung abscess" },
  J86: { code: "312682007", display: "Empyema" },
  J90: { code: "60046008", display: "Pleural effusion" },
  J93: { code: "36118008", display: "Pneumothorax" },
  "J96.0": { code: "65710008", display: "Acute respiratory failure" },
  "J98.0": { code: "4386001", display: "Bronchospasm" },

  // Digestive (K00-K93)
  K02: { code: "80967001", display: "Dental caries" },
  K04: { code: "109564008", display: "Disorder of dental pulp" },
  K05: { code: "66383009", display: "Gingivitis" },
  K12: { code: "61170000", display: "Stomatitis" },
  K13: { code: "26284000", display: "Disorder of oral mucosa" },
  K20: { code: "235595009", display: "Esophagitis" },
  "K21.0": { code: "235595009", display: "Gastroesophageal reflux disease" },
  "K21.9": { code: "235595009", display: "Gastroesophageal reflux disease" },
  K27: { code: "13200003", display: "Peptic ulcer" },
  K29: { code: "4556007", display: "Gastritis" },
  K35: { code: "85189001", display: "Acute appendicitis" },
  K37: { code: "74400008", display: "Appendicitis" },
  K40: { code: "396232000", display: "Inguinal hernia" },
  K42: { code: "396347007", display: "Umbilical hernia" },
  "K52.9": { code: "64613007", display: "Noninfective gastroenteritis" },
  "K56.1": { code: "47410004", display: "Intussusception" },
  "K56.6": { code: "81060008", display: "Intestinal obstruction" },
  "K59.0": { code: "14760008", display: "Constipation" },
  "K59.04": { code: "14760008", display: "Constipation" },
  K60: { code: "1285009", display: "Anal fissure" },
  "K62.3": { code: "57773001", display: "Rectal prolapse" },
  K72: { code: "59927004", display: "Hepatic failure" },
  K74: { code: "19943007", display: "Cirrhosis of liver" },
  K75: { code: "3723001", display: "Hepatitis" },
  "K75.0": { code: "48895003", display: "Liver abscess" },
  K76: { code: "235856003", display: "Disorder of liver" },
  "K76.6": { code: "34742003", display: "Portal hypertension" },
  K85: { code: "197456007", display: "Acute pancreatitis" },
  K86: { code: "3855007", display: "Disorder of pancreas" },
  "K90.0": { code: "396331005", display: "Celiac disease" },
  "K90.9": { code: "32230006", display: "Malabsorption syndrome" },
  "K92.2": { code: "74474003", display: "Gastrointestinal hemorrhage" },

  // Skin (L00-L99)
  "L01.0": { code: "48277006", display: "Impetigo" },
  L03: { code: "128045006", display: "Cellulitis" },
  "L20.9": { code: "200775004", display: "Atopic dermatitis" },
  L21: { code: "86708008", display: "Seborrheic dermatitis" },
  L22: { code: "91487003", display: "Diaper dermatitis" },
  L23: { code: "40275004", display: "Contact dermatitis" },
  L24: { code: "40275004", display: "Irritant contact dermatitis" },
  "L25.9": { code: "40275004", display: "Contact dermatitis" },
  L27: { code: "238575004", display: "Dermatitis due to ingested substance" },
  L28: { code: "399041006", display: "Lichen simplex chronicus" },
  L29: { code: "418290006", display: "Pruritus" },
  L30: { code: "43116000", display: "Eczema" },
  L40: { code: "9014002", display: "Psoriasis" },
  L42: { code: "77252004", display: "Pityriasis rosea" },
  L50: { code: "126485001", display: "Urticaria" },
  L51: { code: "36715001", display: "Erythema multiforme" },
  L52: { code: "36715001", display: "Erythema nodosum" },
  L53: { code: "70819003", display: "Erythematous condition" },
  L70: { code: "11381005", display: "Acne" },
  L73: { code: "13600006", display: "Folliculitis" },
  L74: { code: "44913001", display: "Miliaria" },
  L81: { code: "23712008", display: "Pigmentation disorder" },

  // Musculoskeletal (M00-M99)
  "M04.1": { code: "405786005", display: "Periodic fever syndrome" },
  M08: { code: "410795001", display: "Juvenile idiopathic arthritis" },
  M13: { code: "3723001", display: "Arthritis" },
  "M30.3": { code: "75053002", display: "Kawasaki disease" },
  M32: { code: "55464009", display: "Systemic lupus erythematosus" },
  M33: { code: "396230008", display: "Dermatomyositis" },
  M35: { code: "105969002", display: "Connective tissue disease" },
  M60: { code: "26889001", display: "Myositis" },
  "M79.1": { code: "68962001", display: "Myalgia" },
  M86: { code: "60168000", display: "Osteomyelitis" },

  // Genitourinary (N00-N99)
  N00: { code: "36171008", display: "Acute glomerulonephritis" },
  N01: { code: "36171008", display: "Rapidly progressive glomerulonephritis" },
  N02: { code: "34436003", display: "Hematuria" },
  N04: { code: "52254009", display: "Nephrotic syndrome" },
  N05: { code: "36171008", display: "Nephritic syndrome" },
  N10: { code: "36689008", display: "Acute pyelonephritis" },
  N12: { code: "28635002", display: "Tubulointerstitial nephritis" },
  N13: { code: "197760005", display: "Obstructive uropathy" },
  "N13.3": { code: "43064006", display: "Hydronephrosis" },
  N17: { code: "14669001", display: "Acute renal failure" },
  N18: { code: "709044004", display: "Chronic kidney disease" },
  N19: { code: "42399005", display: "Renal failure" },
  N20: { code: "95570007", display: "Kidney stone" },
  N31: { code: "397699006", display: "Neurogenic bladder" },
  N32: { code: "397699006", display: "Disorder of bladder" },
  "N39.0": { code: "68566005", display: "Urinary tract infection" },
  N43: { code: "55434001", display: "Hydrocele" },
  N44: { code: "81996005", display: "Torsion of testis" },
  N45: { code: "274718005", display: "Orchitis" },
  N47: { code: "449826002", display: "Phimosis" },
  "N48.2": { code: "64665001", display: "Inflammatory disorder of penis" },

  // Perinatal (P00-P96)
  "P05.1": { code: "276610007", display: "Small for gestational age" },
  "P05.9": { code: "22033007", display: "Fetal growth restriction" },
  P07: { code: "395507008", display: "Premature infant" },
  "P07.0": { code: "276610007", display: "Very low birth weight infant" },
  "P07.1": { code: "276610007", display: "Low birth weight infant" },
  "P07.2": { code: "395507008", display: "Extremely premature infant" },
  P08: { code: "433141007", display: "Post-term infant" },
  "P08.1": { code: "118185001", display: "Large for gestational age" },
  "P12.0": { code: "206283007", display: "Cephalohematoma" },
  "P21.9": { code: "768962006", display: "Birth asphyxia" },
  "P22.0": {
    code: "46775006",
    display: "Respiratory distress syndrome in newborn",
  },
  "P22.1": { code: "276517002", display: "Transient tachypnea of newborn" },
  "P22.9": { code: "46775006", display: "Neonatal respiratory distress" },
  P23: { code: "78895009", display: "Congenital pneumonia" },
  "P24.0": { code: "56272000", display: "Meconium aspiration syndrome" },
  P25: { code: "36118008", display: "Neonatal pneumothorax" },
  P26: { code: "276524003", display: "Pulmonary hemorrhage of newborn" },
  "P28.4": { code: "371107009", display: "Apnea of newborn" },
  "P29.3": {
    code: "276513009",
    display: "Persistent pulmonary hypertension of newborn",
  },
  "P35.0": { code: "1857005", display: "Congenital rubella syndrome" },
  "P35.1": {
    code: "416089002",
    display: "Congenital cytomegalovirus infection",
  },
  "P36.9": { code: "206293005", display: "Neonatal sepsis" },
  "P37.1": { code: "73893000", display: "Congenital toxoplasmosis" },
  "P37.9": { code: "206307000", display: "Neonatal meningitis" },
  P38: { code: "206299006", display: "Omphalitis of newborn" },
  "P39.1": { code: "206313009", display: "Neonatal conjunctivitis" },
  P52: { code: "276647007", display: "Intracranial hemorrhage of newborn" },
  P53: { code: "387712008", display: "Hemorrhagic disease of newborn" },
  P55: { code: "387700004", display: "Hemolytic disease of newborn" },
  "P59.9": { code: "387712008", display: "Neonatal jaundice" },
  P61: { code: "276543001", display: "Neonatal anemia" },
  "P61.0": { code: "276549002", display: "Neonatal thrombocytopenia" },
  "P61.1": { code: "276551003", display: "Neonatal polycythemia" },
  "P70.4": { code: "206453001", display: "Neonatal hypoglycemia" },
  P71: { code: "276546005", display: "Neonatal hypocalcemia" },
  "P74.1": { code: "206541002", display: "Neonatal dehydration" },
  "P76.9": { code: "206525008", display: "Intestinal obstruction of newborn" },
  P77: { code: "206525008", display: "Necrotizing enterocolitis of newborn" },
  P81: {
    code: "276545009",
    display: "Neonatal temperature regulation disorder",
  },
  P90: { code: "91175000", display: "Neonatal seizure" },
  "P91.6": {
    code: "206596003",
    display: "Hypoxic ischemic encephalopathy of newborn",
  },
  "P92.9": { code: "78164000", display: "Feeding problem in newborn" },
  "P96.1": { code: "206599005", display: "Neonatal drug withdrawal syndrome" },
  "P96.8": { code: "276527005", display: "Neonatal shock" },

  // Congenital (Q00-Q99)
  Q02: { code: "1829003", display: "Microcephaly" },
  Q03: { code: "73219003", display: "Congenital hydrocephalus" },
  Q04: { code: "89369001", display: "Congenital malformation of brain" },
  "Q20.3": { code: "399216004", display: "Transposition of great vessels" },
  "Q21.0": { code: "30288003", display: "Ventricular septal defect" },
  "Q21.1": { code: "70142008", display: "Atrial septal defect" },
  "Q21.3": { code: "86299006", display: "Tetralogy of Fallot" },
  "Q22.1": { code: "56786000", display: "Pulmonic valve stenosis" },
  "Q23.9": { code: "253426002", display: "Congenital aortic valve disorder" },
  "Q24.9": { code: "13213009", display: "Congenital heart disease" },
  "Q25.0": { code: "83330001", display: "Patent ductus arteriosus" },
  "Q25.1": { code: "7305005", display: "Coarctation of aorta" },
  Q26: { code: "13213009", display: "Congenital malformation of great veins" },
  "Q26.2": {
    code: "204456009",
    display: "Total anomalous pulmonary venous connection",
  },
  "Q30.0": { code: "367486001", display: "Choanal atresia" },
  Q35: { code: "87979003", display: "Cleft palate" },
  Q36: { code: "80281008", display: "Cleft lip" },
  Q37: { code: "66948001", display: "Cleft palate with cleft lip" },
  "Q39.0": { code: "26059007", display: "Esophageal atresia" },
  "Q39.1": { code: "95440006", display: "Tracheoesophageal fistula" },
  "Q40.0": { code: "204669006", display: "Congenital pyloric stenosis" },
  "Q41.0": { code: "88032004", display: "Duodenal atresia" },
  "Q41.1": { code: "39498001", display: "Jejunal atresia" },
  "Q41.2": { code: "396361005", display: "Ileal atresia" },
  "Q42.2": { code: "204731002", display: "Imperforate anus" },
  "Q43.1": { code: "367494004", display: "Hirschsprung disease" },
  Q53: { code: "204878001", display: "Undescended testis" },
  Q54: { code: "416010008", display: "Hypospadias" },
  Q60: { code: "7163005", display: "Renal agenesis" },
  Q61: { code: "429087006", display: "Cystic kidney disease" },
  Q62: { code: "95564005", display: "Congenital ureteral obstruction" },
  "Q64.2": { code: "253858006", display: "Posterior urethral valve" },
  Q65: { code: "415683001", display: "Developmental dysplasia of hip" },
  Q66: { code: "397932003", display: "Congenital foot deformity" },
  Q67: { code: "66904006", display: "Congenital musculoskeletal deformity" },
  Q69: { code: "367506006", display: "Polydactyly" },
  Q70: { code: "373413006", display: "Syndactyly" },
  Q71: { code: "302297009", display: "Upper limb reduction defect" },
  Q72: { code: "302298004", display: "Lower limb reduction defect" },
  Q75: { code: "27341007", display: "Craniosynostosis" },
  "Q78.0": { code: "78314001", display: "Osteogenesis imperfecta" },
  "Q79.0": { code: "17190001", display: "Congenital diaphragmatic hernia" },
  "Q79.2": { code: "18735004", display: "Omphalocele" },
  "Q79.3": { code: "72951007", display: "Gastroschisis" },
  Q84: { code: "31024001", display: "Congenital skin disorder" },
  Q87: { code: "66091009", display: "Congenital malformation syndrome" },
  Q90: { code: "41040004", display: "Down syndrome" },
  Q91: { code: "51500006", display: "Edwards syndrome" },
  Q92: { code: "52451004", display: "Trisomy" },
  Q96: { code: "38804009", display: "Turner syndrome" },
  Q97: { code: "38804009", display: "Sex chromosome abnormality" },
  Q98: { code: "405769009", display: "Klinefelter syndrome" },
  Q99: { code: "409709004", display: "Chromosomal abnormality" },

  // Symptoms/Signs (R00-R99)
  "R04.0": { code: "12441001", display: "Epistaxis" },
  "R06.0": { code: "267036007", display: "Dyspnea" },
  "R06.2": { code: "56018004", display: "Wheezing" },
  "R09.2": { code: "87317003", display: "Respiratory arrest" },
  "R10.9": { code: "21522001", display: "Abdominal pain" },
  R11: { code: "422400008", display: "Vomiting" },
  "R11.1": { code: "422400008", display: "Vomiting" },
  "R16.2": { code: "36760000", display: "Hepatosplenomegaly" },
  "R19.7": { code: "62315008", display: "Diarrhea" },
  "R27.0": { code: "20262006", display: "Ataxia" },
  R31: { code: "34436003", display: "Hematuria" },
  "R40.2": { code: "371632003", display: "Coma" },
  "R41.82": { code: "419284004", display: "Altered mental status" },
  "R50.9": { code: "386661006", display: "Fever" },
  R51: { code: "25064002", display: "Headache" },
  "R56.0": { code: "41497008", display: "Febrile seizure" },
  "R56.00": { code: "41497008", display: "Febrile seizure" },
  "R57.0": { code: "89138009", display: "Cardiogenic shock" },
  "R57.1": { code: "39419009", display: "Hypovolemic shock" },
  "R57.2": { code: "76571007", display: "Septic shock" },
  R59: { code: "30746006", display: "Lymphadenopathy" },
  "R62.0": { code: "248290002", display: "Delayed milestone" },
  "R62.51": { code: "36440009", display: "Failure to thrive" },
  "R63.3": { code: "78164000", display: "Feeding difficulty" },
  "R63.4": { code: "267024001", display: "Abnormal weight loss" },
  "R65.1": {
    code: "238150007",
    display: "Systemic inflammatory response syndrome",
  },
  R80: { code: "29738008", display: "Proteinuria" },

  // Injuries (S00-T98)
  S06: { code: "127295002", display: "Traumatic brain injury" },
  T07: { code: "397996002", display: "Multiple trauma" },
  "T14.1": { code: "283680004", display: "Open wound" },
  T15: { code: "767007", display: "Foreign body in eye" },
  T16: { code: "301932007", display: "Foreign body in ear" },
  T17: { code: "56198003", display: "Foreign body in respiratory tract" },
  T18: { code: "34713006", display: "Foreign body in alimentary tract" },
  T30: { code: "48333001", display: "Burn" },
  T31: { code: "48333001", display: "Burn injury" },
  T39: { code: "75478009", display: "Poisoning by analgesic" },
  T42: { code: "72431002", display: "Poisoning by anticonvulsant" },
  T50: { code: "75478009", display: "Poisoning by drug" },
  T51: { code: "23037004", display: "Toxic effect of alcohol" },
  T54: { code: "269704000", display: "Toxic effect of corrosive substance" },
  T60: { code: "212593006", display: "Toxic effect of pesticide" },
  T63: { code: "75702006", display: "Envenomation" },
  T71: { code: "66466001", display: "Asphyxia" },
  T74: { code: "397940009", display: "Child abuse" },
  "T75.4": { code: "242784006", display: "Electric shock" },
  "T78.2": { code: "39579001", display: "Anaphylaxis" },
  "T78.4": { code: "419076005", display: "Allergic reaction" },

  // COVID
  "U07.1": { code: "840539006", display: "COVID-19" },
};

// Build output
const output = rows.map((row) => {
  // Try exact match first, then try progressively shorter codes
  let mapping = ICD10_TO_SNOMED[row.icd10];

  if (!mapping) {
    // Try removing sub-codes: J45.901 → J45.9 → J45
    const parts = row.icd10.split(".");
    if (parts.length > 1) {
      // Try parent with partial decimal
      const decimal = parts[1];
      for (let len = decimal.length - 1; len >= 1; len--) {
        const tryCode = parts[0] + "." + decimal.substring(0, len);
        if (ICD10_TO_SNOMED[tryCode]) {
          mapping = ICD10_TO_SNOMED[tryCode];
          break;
        }
      }
      // Try just the main code
      if (!mapping) {
        mapping = ICD10_TO_SNOMED[parts[0]];
      }
    }
  }

  return {
    id: row.id,
    icd10: row.icd10,
    diagnosis_name: row.diagnosis_name,
    snomed_code: mapping ? mapping.code : null,
    snomed_display: mapping ? mapping.display : null,
  };
});

const mapped = output.filter((r) => r.snomed_code !== null).length;
const unmapped = output.filter((r) => r.snomed_code === null).length;

console.log(`Total: ${output.length}`);
console.log(`Mapped: ${mapped}`);
console.log(`Unmapped: ${unmapped}`);

if (unmapped > 0) {
  console.log("\nUnmapped entries:");
  output
    .filter((r) => r.snomed_code === null)
    .forEach((r) => {
      console.log(`  ${r.icd10} - ${r.diagnosis_name}`);
    });
}

const outPath = path.join(
  __dirname,
  "..",
  "data",
  "snomed_diagnosis_mappings.json",
);
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nWritten to: ${outPath}`);
