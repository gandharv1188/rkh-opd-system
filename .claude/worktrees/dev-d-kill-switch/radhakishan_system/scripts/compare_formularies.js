const fs = require("fs");
const path = require("path");

// DB drugs from Supabase query (active=true)
const dbDrugs = [
  "Abacavir/Lamivudine",
  "Abatacept",
  "Acetazolamide",
  "Acetic acid 2% otic solution",
  "Actinomycin D + Vincristine (EE-4A)",
  "Acyclovir",
  "Adalimumab",
  "Adapalene 0.1% gel",
  "Adenosine",
  "Albendazole",
  "Albumin + Furosemide",
  "Albumin 5%",
  "Allopurinol",
  "Almotriptan",
  "Alpha-lipoic acid",
  "Alternating acetaminophen/ibuprofen",
  "Amikacin",
  "Aminophylline",
  "Amiodarone",
  "Amitriptyline",
  "Amlodipine",
  "Amoxicillin",
  "Amoxicillin-Clavulanate",
  "Amphotericin B",
  "Ampicillin",
  "Ampicillin + Gentamicin",
  "Ampicillin-sulbactam",
  "Anakinra",
  "Anhydrous lanolin",
  "Apremilast",
  "Arimoclomol (NPC)",
  "Aripiprazole",
  "Artemether-lumefantrine",
  "Artesunate",
  "Artesunate-amodiaquine",
  "Artesunate-Pyronaridine",
  "Artificial tears (preservative-free)",
  "Aspirin",
  "Ataluren",
  "Atenolol",
  "Atomoxetine",
  "Atropine",
  "Atropine 0.05% eye drops",
  "Atropine 1% eye drops (penalization)",
  "Atropine sulfate",
  "Azathioprine",
  "Azelaic acid 15-20% cream",
  "Azithromycin",
  "Azithromycin 1% ophthalmic",
  "Azithromycin oral",
  "Azithromycin prophylaxis",
  "Bacitracin ointment",
  "Baclofen",
  "Baloxavir marboxil",
  "Baloxavir marboxil (if influenza)",
  "Baricitinib",
  "Belimumab",
  "Benzathine penicillin G",
  "Benzoyl peroxide 2.5-5%",
  "Benztropine",
  "Betaine (trimethylglycine)",
  "Betamethasone 0.05%",
  "Betamethasone dipropionate 0.05%",
  "Bevacizumab",
  "Bismuth subsalicylate",
  "Bosentan",
  "Botulinum toxin A",
  "Botulinum toxin A injection",
  "Botulinum toxin injection",
  "Brentuximab vedotin",
  "Brentuximab vedotin (single)",
  "Brentuximab vedotin + AVEPC",
  "Budesonide",
  "Budesonide (oral viscous)",
  "Budesonide nebulized",
  "Budesonide-Formoterol",
  "Caffeine citrate",
  "Calcipotriene 0.005% cream",
  "Calcitriol",
  "Calcium carbonate",
  "Calcium gluconate (neonatal)",
  "Calcium Gluconate 10%",
  "Canakinumab",
  "Captopril",
  "Carbamazepine",
  "Carbamide peroxide 6.5%",
  "Carvedilol",
  "Casgevy (exagamglogene autotemcel)",
  "Cefazolin",
  "Cefdinir",
  "Cefepime",
  "Cefixime",
  "Cefotaxime",
  "Ceftriaxone",
  "Cenobamate",
  "Cephalexin",
  "Cetirizine",
  "Chloramphenicol",
  "Chlorhexidine gluconate 0.12%",
  "Chloroquine",
  "Cholecalciferol",
  "Cholestyramine",
  "Ciclopirox 1% cream/shampoo",
  "Ciclopirox 8% nail lacquer",
  "Cidofovir",
  "Ciprofloxacin",
  "Ciprofloxacin otic preparations",
  "Cisatracurium",
  "Clarithromycin",
  "Clindamycin",
  "Clindamycin 1% + Benzoyl peroxide 5% gel",
  "Clindamycin 1% lotion",
  "Clobetasol propionate 0.05%",
  "Clonazepam",
  "Clonidine",
  "Clotrimazole 1% cream",
  "Clotrimazole troches",
  "Coenzyme Q10",
  "Colchicine",
  "Colloid (Dextran 40)",
  "Copper supplementation",
  "CPX-351 (liposomal Ara-C/dauno)",
  "Crinecerfont",
  "Crotalidae Polyvalent Immune Fab (CroFab)",
  "Crotamiton 10% cream",
  "Cyanocobalamin",
  "Cyanocobalamin (IM)",
  "Cyclopentolate 1% ophthalmic",
  "Cyclophosphamide",
  "Cyclosporine",
  "Cyproheptadine",
  "Dantrolene",
  "Darbepoetin",
  "Deferasirox",
  "Deferiprone",
  "Deferoxamine",
  "Deflazacort",
  "Denosumab",
  "Desloratadine",
  "Desmopressin",
  "Dexamethasone",
  "Dextromethorphan",
  "Dextrose 10%",
  "Dextrose gel 40%",
  "Dextrose infusion",
  "DHA-piperaquine",
  "Diazepam",
  "Diazoxide",
  "Diclofenac",
  "Digoxin",
  "Diltiazem (topical)",
  "Dimenhydrinate",
  "Dimethicone 4% lotion",
  "Diphenhydramine",
  "Diphtheria antitoxin (DAT)",
  "Dobutamine",
  "Docusate sodium 1% drops",
  "Dolutegravir (DTG)",
  "Dopamine",
  "Dornase alfa",
  "Doxapram",
  "Doxorubicin",
  "Doxycycline",
  "Duloxetine",
  "Dupilumab",
  "Eculizumab",
  "Efavirenz",
  "Elexacaftor/tezacaftor/ivacaftor",
  "Eltrombopag",
  "Emapalumab",
  "Emicizumab",
  "Enalapril",
  "Entecavir",
  "Epinephrine",
  "Epinephrine nasal spray (Neffy)",
  "EPO (erythropoietin)",
  "Epoprostenol",
  "Equine RIG (ERIG)",
  "Ergocalciferol (Vitamin D2)",
  "Ertapenem",
  "Erythromycin",
  "Erythropoietin",
  "Escitalopram",
  "Esmolol",
  "Esomeprazole",
  "Estradiol",
  "Estradiol (transdermal)",
  "Etanercept",
  "Eteplirsen",
  "Ethambutol",
  "Ethionamide",
  "Ethosuximide",
  "Etoposide",
  "Extended half-life FIX (rIX-FP)",
  "Factor IX",
  "Factor VIII",
  "Famciclovir",
  "Famotidine",
  "Fentanyl",
  "Ferrous fumarate",
  "Ferrous sulfate",
  "Fexofenadine",
  "Fitusiran",
  "Flecainide",
  "Fluconazole",
  "Fludrocortisone",
  "Flumazenil",
  "Fluocinonide",
  "Fluoxetine",
  "Fluphenazine",
  "Fluticasone (swallowed)",
  "Fluticasone propionate nasal spray",
  "Fluvoxamine",
  "Folic acid",
  "Folic acid (parenteral)",
  "Folic acid high-dose",
  "Folinic Acid (Leucovorin)",
  "Fomepizole",
  "Fortified tobramycin 1.4% + cefazolin 5%",
  "Foscarnet",
  "Fosphenytoin",
  "Furosemide",
  "G-CSF (Filgrastim)",
  "Gabapentin",
  "Galsulfase (MPS VI)",
  "Ganciclovir",
  "Gatifloxacin 0.5% ophthalmic",
  "Gemtuzumab ozogamicin",
  "Gentamicin",
  "GH therapy (PWS)",
  "Glecaprevir/pibrentasvir (Mavyret)",
  "Glucagon",
  "Glycerin suppositories",
  "Glycopyrrolate",
  "GnRH (Buserelin)",
  "Griseofulvin microsize oral",
  "Growth hormone therapy",
  "Guanfacine",
  "Guanfacine ER",
  "Histrelin implant",
  "HRIG (Human Rabies Ig)",
  "Human TIG",
  "Hyaluronidase-facilitated SCIG",
  "Hydrochlorothiazide",
  "Hydrocortisone",
  "Hydrocortisone 0.5-1% cream",
  "Hydrocortisone 1% cream",
  "Hydrocortisone 2.5% cream",
  "Hydrogen peroxide 1.5% rinse",
  "Hydroquinone 2-4% cream",
  "Hydroxocobalamin (IM)",
  "Hydroxychloroquine",
  "Hydroxyurea",
  "Hydroxyzine",
  "Ibuprofen",
  "Idursulfase",
  "Ifosfamide + Doxorubicin",
  "Ifosfamide + Etoposide",
  "Imiglucerase",
  "Imipramine",
  "Indomethacin",
  "Infliximab",
  "Inotuzumab ozogamicin",
  "Insulin (Regular)",
  "Insulin Aspart",
  "Insulin Glargine",
  "Intranasal Fluticasone",
  "Intrapleural urokinase",
  "Intrathecal baclofen",
  "Intrathecal cytarabine",
  "Iodoquinol",
  "Ipratropium bromide",
  "Iron polymaltose (Fe3+)",
  "Isoniazid (H)",
  "Isotretinoin",
  "Itraconazole oral",
  "IV Artesunate",
  "IV Hydrocortisone",
  "IV iron (ferric carboxymaltose)",
  "IV methylprednisolone",
  "IV pamidronate",
  "IV zoledronic acid",
  "Ivacaftor (Kalydeco)",
  "Ivermectin",
  "Ivermectin 0.5% lotion",
  "IVIG",
  "Ketamine",
  "Ketoconazole 2% cream",
  "Ketoconazole 2% shampoo",
  "Ketorolac",
  "Ketotifen 0.025% ophthalmic (OTC)",
  "L-Carnitine",
  "Lactated Ringer",
  "Lactobacillus rhamnosus GG",
  "Lactulose",
  "Lamotrigine",
  "Lansoprazole",
  "Ledipasvir/sofosbuvir (Harvoni)",
  "Letrozole",
  "Leucovorin (folinic acid)",
  "Leuprolide acetate",
  "Levetiracetam",
  "Levodopa/carbidopa",
  "Levofloxacin",
  "Levothyroxine",
  "Lidocaine (viscous)",
  "Lidocaine 1%",
  "Linezolid",
  "Lipid Emulsion 20%",
  "Liraglutide (Saxenda)",
  "Lisinopril",
  "Lithium",
  "Loperamide",
  "Lopinavir/Ritonavir",
  "Loratadine",
  "Lorazepam",
  "Losartan",
  "Lyfgenia (lovotibeglogene autotemcel)",
  "Macitentan",
  "Mafenide Acetate",
  "Magnesium sulfate",
  "Mannitol",
  "Marstacimab",
  "Mavacamten",
  "Mebendazole",
  "Melatonin",
  "Meropenem",
  "Metformin",
  "Methadone",
  "Methimazole",
  "Methotrexate",
  "Methylcobalamin",
  "Methylphenidate",
  "Methylprednisolone",
  "Metoclopramide",
  "Metronidazole",
  "Micafungin",
  "Miconazole",
  "Midazolam",
  "Miglustat",
  "Milrinone",
  "Mirabegron",
  "Mometasone",
  "Montelukast",
  "Morphine",
  "Moxifloxacin (ophthalmic)",
  "Mupirocin",
  "Mycophenolate mofetil",
  "N-Acetylcysteine (NAC)",
  "Nafcillin",
  "Naloxone",
  "Naproxen",
  "Nasal saline drops/spray",
  "Natamycin",
  "Nebulized epinephrine",
  "Nebulized hypertonic saline",
  "Nelarabine",
  "Neomycin/Polymyxin B/Hydrocortisone otic",
  "Nifedipine",
  "Nirmatrelvir/Ritonavir",
  "Nirsevimab",
  "Nitazoxanide",
  "Nitrofurantoin",
  "Nivolumab",
  "Norepinephrine",
  "Normal Saline (0.9% Sodium Chloride)",
  "Nystatin",
  "Obidoxime",
  "Octreotide",
  "Ofloxacin 0.3% otic",
  "Olopatadine",
  "Omalizumab",
  "Omaveloxolone",
  "Omeprazole",
  "Ondansetron",
  "Oral Vitamin K (Phytomenadione)",
  "Orlistat",
  "Oseltamivir",
  "Oxandrolone",
  "Oxcarbazepine",
  "Oxybutynin",
  "Oxymetazoline",
  "Palivizumab",
  "Pancreatic enzyme replacement (Pancrelipase)",
  "Pancreatic enzymes (Pancrelipase) for CF",
  "Paracetamol",
  "Paromomycin",
  "Paromomycin (luminal agent)",
  "Patiromer",
  "PEG 3350 (Polyethylene Glycol)",
  "Pegfilgrastim",
  "Pegvaliase",
  "Penicillin G (Benzylpenicillin)",
  "Penicillin G procaine",
  "Penicillin V",
  "Penicillin V (prophylaxis)",
  "Pentobarbital",
  "Peppermint oil (enteric-coated)",
  "Peramivir",
  "Permethrin 1% lotion",
  "Permethrin 5% cream",
  "Petrolatum barrier ointment",
  "Petroleum jelly (Vaseline)",
  "Phenobarbital",
  "Phentermine/topiramate",
  "Phenytoin",
  "Phytonadione",
  "Phytonadione (Vitamin K1)",
  "Pimecrolimus 1% cream",
  "Piperacillin-tazobactam",
  "Pivmecillinam",
  "Polyethylene Glycol 3350 (MiraLAX)",
  "Polymyxin B-Trimethoprim drops",
  "Potassium citrate",
  "Potassium iodide",
  "Potassium phosphate",
  "Pralidoxime (2-PAM)",
  "Pravastatin",
  "Praziquantel",
  "Precipitated sulfur 5-10%",
  "Prednis(ol)one",
  "Prednisolone",
  "Prednisone",
  "Primaquine (radical cure)",
  "Probiotics (LGG)",
  "Probiotics (prevention)",
  "Probiotics (S. boulardii)",
  "Promethazine",
  "Proparacaine",
  "Propranolol",
  "Prostaglandin E1",
  "Proton Pump Inhibitor",
  "Pyrantel pamoate",
  "Pyrazinamide (Z)",
  "Pyridostigmine",
  "Pyridoxine (B6)",
  "Pyridoxine (vitamin B6)",
  "Pyrimethamine",
  "Quinine",
  "Racecadotril",
  "Radioactive iodine (I-131)",
  "Raltegravir",
  "Ranitidine/Famotidine",
  "Rasburicase",
  "Recombinant Factor VIIa",
  "Regular insulin IV infusion",
  "Remdesivir",
  "Retinol (Vitamin A)",
  "Ribavirin",
  "Riboflavin (Vitamin B2)",
  "Rifampicin",
  "Rilonacept",
  "Riluzole",
  "Risedronate",
  "Risperidone",
  "Rituximab",
  "Rizatriptan",
  "Romiplostim",
  "Ruxolitinib cream 1.5%",
  "Saccharomyces boulardii",
  "Sacubitril-Valsartan",
  "Salbutamol (Albuterol)",
  "Sapropterin (BH4)",
  "Sarecycline",
  "Selenium sulfide 2.5%",
  "Selexipag",
  "Semaglutide",
  "Senna (Sennosides)",
  "Sertraline",
  "Sevelamer",
  "Sildenafil",
  "Silver Sulfadiazine 1%",
  "Sirolimus",
  "Sodium Bicarbonate",
  "Sodium bicarbonate ear drops 5%",
  "Sodium Polystyrene Sulfonate",
  "Sofosbuvir/Velpatasvir",
  "Somatropin",
  "Sotalol",
  "Spinosad 0.9% topical",
  "Spironolactone",
  "Sucralfate",
  "Sulfadiazine",
  "Sulfasalazine",
  "Sumatriptan",
  "Surfactant (Poractant alfa)",
  "Tacrolimus",
  "Tafenoquine",
  "Tamsulosin",
  "Temozolomide",
  "Tenofovir DF/Emtricitabine",
  "Tenofovir disoproxil",
  "Terbinafine",
  "Terbutaline",
  "Testosterone",
  "Tetrabenazine",
  "Thiamine",
  "Tinidazole",
  "Tizanidine",
  "TMP-SMX (Cotrimoxazole)",
  "Tocilizumab",
  "Tofacitinib",
  "Tolterodine",
  "Tolvaptan",
  "Topiramate",
  "Tranexamic Acid",
  "Trazodone",
  "Treprostinil",
  "Triamcinolone",
  "Trihexyphenidyl",
  "Triptorelin",
  "Tris-Hydroxymethyl Aminomethane",
  "Ursodeoxycholic acid",
  "Ustekinumab",
  "Valacyclovir",
  "Valbenazine",
  "Valganciclovir",
  "Valproate",
  "Vancomycin",
  "Velaglucerase alfa",
  "Vitamin A",
  "Vitamin C",
  "Vitamin E",
  "Voclosporin",
  "Voriconazole",
  "Warfarin",
  "Zanamivir",
  "Zinc oxide ointment",
  "Zinc pyrithione 1% shampoo",
  "Zinc sulfate",
];

// Parse CSV
const csvPath = path.join(
  __dirname,
  "..",
  "docs",
  "RADHIKA MEDICINE DRUG FORMULARY.csv",
);
const csv = fs.readFileSync(csvPath, "utf8");
const lines = csv.split("\n");
const csvDrugsSet = new Set();

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const fields = [];
  let current = "",
    inQuote = false;
  for (let c = 0; c < line.length; c++) {
    if (line[c] === '"') inQuote = !inQuote;
    else if (line[c] === "," && !inQuote) {
      fields.push(current.trim());
      current = "";
    } else current += line[c];
  }
  fields.push(current.trim());
  const drugNo = fields[0],
    medicine = (fields[2] || "").trim();
  if (drugNo && /^\d+$/.test(drugNo) && medicine)
    csvDrugsSet.add(medicine.toUpperCase());
}

const csvDrugs = [...csvDrugsSet].sort();

// Manual mapping: CSV UPPER -> DB name (null = genuinely not in DB)
const manual = {
  "KETAMINE HYDROCHLORIDE": "Ketamine",
  "LIGNOCAINE HYDROCHLORIDE": "Lidocaine 1%",
  "LIGNOCAINE HYDROCHLORIDE+ADRENALINE": "Lidocaine 1%",
  "ATROPINE SULPHATE": "Atropine sulfate",
  "DIAZEPAM IP": "Diazepam",
  "FENTANYL IP": "Fentanyl",
  HYDROXICHLOROQUINE: "Hydroxychloroquine",
  CETRIZINE: "Cetirizine",
  "METHYL PREDNISOLONE": "Methylprednisolone",
  TERBINAFIN: "Terbinafine",
  ADERNALINE: "Epinephrine",
  "FEXOFENADINE HCL": "Fexofenadine",
  GABAPENTINE: "Gabapentin",
  PHENOBARBITONE: "Phenobarbital",
  "SODIUM VALPROATE": "Valproate",
  "AMOXICILLIN & POTASSIUM CLAVUNATE": "Amoxicillin-Clavulanate",
  "PIPERACILLIN AND TAZOBACTUM": "Piperacillin-tazobactam",
  GENTAMYCIN: "Gentamicin",
  "VANCOMYCIN INJECTION": "Vancomycin",
  "MEROPENEM INJECTION": "Meropenem",
  "LIPOSOMAL AMPHOTERICIN B": "Amphotericin B",
  ACICLOVIR: "Acyclovir",
  ENALPRIL: "Enalapril",
  NORADRENALINE: "Norepinephrine",
  "ACETYLSALICYLIC ACID": "Aspirin",
  "MAGNESIUM SULPHATE": "Magnesium sulfate",
  ONDASETRON: "Ondansetron",
  PERMETHRINE: "Permethrin 5% cream",
  THYROXIN: "Levothyroxine",
  "GLYCOPYROLATE OSP": "Glycopyrrolate",
  "MILRINONE LACTATE": "Milrinone",
  "AMIODARONE HCL": "Amiodarone",
  CARVEDIOLOL: "Carvedilol",
  "IPRATROPIUM BROMIDE RESPULES": "Ipratropium bromide",
  "DEXTROMETHORPHANE HYDROBROMIDE SYRUP": "Dextromethorphan",
  SALBUTAMOL: "Salbutamol (Albuterol)",
  "ZINC SULPHATE": "Zinc sulfate",
  "METHYL COBALAMINE": "Methylcobalamin",
  "ASCORBIC ACID(VITAMIN C)": "Vitamin C",
  ISONIAZID: "Isoniazid (H)",
  PYRAZINAMIDE: "Pyrazinamide (Z)",
  "RINGER'S LACTATE": "Lactated Ringer",
  "SODIUM CHLORIDE": "Normal Saline (0.9% Sodium Chloride)",
  "HUMAN ALBUMIN": "Albumin 5%",
  "SALINE NASAL SOLUTION": "Nasal saline drops/spray",
  DEXTROSE: "Dextrose 10%",
  "MOMETASONE FUROATE": "Mometasone",
  RANITIDINE: "Ranitidine/Famotidine",
  ITRACONAZOLE: "Itraconazole oral",
  KETOCONAZOLE: "Ketoconazole 2% cream",
  CLOTRIMAZOLE: "Clotrimazole 1% cream",
  INSULIN: "Insulin (Regular)",
  MOXIFLOXACIN: "Moxifloxacin (ophthalmic)",
  OFLOXACIN: "Ofloxacin 0.3% otic",
  "VITAMIN K": "Phytonadione (Vitamin K1)",
  "CALCIUM GLUCONATE": "Calcium Gluconate 10%",
  SULPHUR: "Precipitated sulfur 5-10%",
  "CLOBAETASOL PROPIONATE,NEOMYCIN SULPHATE & MICONAZOLE NITRATE":
    "Clobetasol propionate 0.05%",
  "NEOMYCIN & POLYMIXIN B, BACITRACIN ZINC & HYDROCORTISONE":
    "Neomycin/Polymyxin B/Hydrocortisone otic",
  "NIFEDIPINE+LIDOCAINE": "Nifedipine",
  ALPROSTADIL: "Prostaglandin E1",
  "POTASSIUM CITRATE & CITRIC ACID": "Potassium citrate",
  "HYDROGEN PEROXIDE SOLUTION": "Hydrogen peroxide 1.5% rinse",
  "FERROUS FUMARATE & FOLIC ACID": "Ferrous fumarate",
  "FERROUS ASCORBATE & FOLIC ACID": "Ferrous sulfate",
  "IRON SUCROSE": "IV iron (ferric carboxymaltose)",
  "FERRIC CARBOXYMALTOSE": "IV iron (ferric carboxymaltose)",
  "ANTI RABIES IMMUNOGLOBULIN": "HRIG (Human Rabies Ig)",
  "ANTI RABIES": "HRIG (Human Rabies Ig)",
  BETAMETHASONE: "Betamethasone 0.05%",
  FLUTICASONE: "Fluticasone propionate nasal spray",
  CROTAMITON: "Crotamiton 10% cream",
  CARBOXYPROPYLMEHTYLCELLULOSE: "Artificial tears (preservative-free)",
  CHOLECALCIFEROL: "Cholecalciferol",
  "NEOMYCIN,POLYMIXIN B & BACITRACIN ZINC": null, // triple antibiotic, not in DB as-is
  "SODIUM CHLORIDE & DEXTROSE": null,
  FLUOROMETHOLONE: null,
  "LOTEPREDNOL ETABONATE": null,
  "CROMOLYN SODIUM": null,
  CLOBETASONE: null,
  "CLOBETASONE & MICONAZOLE": null,
  STREPTOKINASE: null,
  CALAMINE: null,
  TOBRAMYCIN: null,
  TROPICAMIDE: null,
  "CLOTRIMAZOLE & BECLOMETHASONE": null,
  "BETAMETHASONE & NEOMYCIN": null,
  "BETAMETHASONE & CLIOQUINOL": null,
  "FUSIDIC ACID & HYDROCORTISONE ACETATE": null,
  FRAMYCETIN: null,
  NORFLOXACIN: null,
  CEFPODOXIME: null,
  "CEFOPERAZONE +SULBACTUM": null,
  CEFUROXIME: null,
  CEFTAZIDIME: null,
  "COLISTIN SULPHATE": null,
  "COLISTIMETHATE SODIUM": null,
  FAROPENEM: null,
  FOSFOMYCIN: null,
  TIGECYCLINE: null,
  "HEPARIN SODIUM": null,
  "ENOXAPARIN SODIUM": null,
  METOPROLOL: null,
  "TELMISARTAN HCL": null,
  "TELMISARTAN HCL & AMLODIPINE": null,
  "TELMISARTAN+HYDROCHLOROTHIAZIDE+AMLODPINE": null,
  "AMLODIPINE+HYDROCHLOROTHIAZIDE": null,
  RAMIPRIL: null,
  LABETALOL: null,
  TORSEMIDE: null,
  TERLIPRESSIN: null,
  VASOPRESSIN: "Vasopressin", // check -- not in list actually
  ROSUVASTATIN: null,
  ATORVASTATIN: null,
  MEPHENTERMINE: null,
  "CHLORPHENIRAMINE MALEATE": null,
  "PHENIRAMINE MALEATE": null,
  LEVOCETRIZINE: null,
  "MONTELUKAST & LEVOCETRIZINE": null,
  "ACECLOFENAC+PARACETAMOL+ SERRATIOPEPTIDASE": null,
  "ACECLOFENAC 100 MG": null,
  "MEFANAMIC ACID": null,
  "MEFANAMIC ACID & PARACETAMOL": null,
  "IBUPROFEN & PARACETAMOL": null,
  "NAPROXEN & DOMPERIDONE": null,
  "TRYPSIN-CHYMOTRYPSIN": null,
  PIROXICAM: null,
  "TRAMADOL HYDROCHLORIDE": null,
  "PENTAZOCINE LACTATE": null,
  "BUTORPHANOL TARTRATE": null,
  NALBUPHINE: null,
  "PREGABALIN & METHYLCOBALAMINE": null,
  TRICLOFOS: null,
  "ANTISNAKE VENOM (POLYVALENT SOLUTION)(DRY POWDER)": null,
  DOMPERIDONE: null,
  DICYCLOMINE: null,
  DROTAVARINE: null,
  "SIMETHICONE+DILLOIL+FENNELOIL": null,
  "HYOSCINE BUTYL BROMIDE": null,
  "LIQUID PARAFFIN+MILK OF MAGNESIA": null,
  "SODIUM PICOSULFATE": null,
  "BACILLUS CLAUSII": null,
  GLICLAZIDE: null,
  NORETHISTERONE: null,
  CARBIMAZOLE: null,
  "ANTI D": null,
  "TETNUS VACCINES": null,
  ATRACURIUM: null,
  "SUCCINYL CHOLINE VIAL": null,
  NEOSTIGMINE: null,
  "VECURONIUM BROMIDE POWDER": null,
  DEXMEDETOMIDINE: null,
  ISOFLURANE: null,
  PROPOFOL: null,
  "THIOPENTONE SODIUM IP": null,
  "SEVOFLURANCE WITH INDEXING COLLER USP": null,
  "BUPIVACAINE HYDROCHLORIDE IP": null,
  "DISODIUM HYDROGEN CITRATE": null,
  ANTACID: null,
  "ORAL REHYDRATION SALTS": null,
  OXYTOCIN: null,
  PROGESTRONE: null,
  CARBOPROST: null,
  CARBETOCIN: null,
  MISOPROSTOL: null,
  VALETHEMATE: null,
  ALPRAZOLAM: null,
  BUSPIRON: null,
  LEVOSALBUTAMOL: null,
  "THEOPHYLLINE ETOPHYLLINE": null,
  "ISOLYTE-P": null,
  "WATER FOR INJECTION": null,
  "L-ARGININE": null,
  "CALCIUM & VITAMIN D3": null,
  "B-COMPLEX": null,
  "MULTIVITAMINS,MULTIMINERALS,AMINO ACID & ANTIOXIDANT": null,
  "BENZALKONIUM & ZINC": null,
  "POVIDONE IODINE": null,
  "BCG VACCINE": null,
  DPT: null,
  "HEPATITIS-A": null,
  "JAPANESE ENCEPHALITIS": null,
  ROTAVIRUS: null,
  VARICELLA: null,
  "PNEUMOCOCCAL POLYSACCHARIDE CONJUGATE": null,
  "MENINGOCOCCAL (GROUP A,C,Y,W-135) POLYSACCHARIDE DIPHTHERIA TOXOID CONJUGATE":
    null,
  "HEPATITIS-B": null,
  MEASELS: null,
  "ORAL POLIOMYELILIS": null,
  "LIQUID PARAFIN": null,
  GLYCEROL: null,
  "ANTI COLD SYRUP": null,
  "HEPATITIS-B (HUMAN IMMUNOGLOBIN )": null,
};

// Remove vasopressin - it's not in DB list
manual["VASOPRESSIN"] = null;

// Build DB lookup
const dbUpper = {};
for (const d of dbDrugs) dbUpper[d.toUpperCase()] = d;

const matched = [],
  csvOnly = [],
  csvMatchedSet = new Set(),
  dbMatchedSet = new Set();

for (const csvDrug of csvDrugs) {
  // Check manual first
  if (manual.hasOwnProperty(csvDrug)) {
    const db = manual[csvDrug];
    if (db) {
      matched.push({ csv: csvDrug, db });
      csvMatchedSet.add(csvDrug);
      dbMatchedSet.add(db.toUpperCase());
    } else {
      csvOnly.push(csvDrug);
      csvMatchedSet.add(csvDrug);
    }
    continue;
  }

  // Direct match
  if (dbUpper[csvDrug]) {
    matched.push({ csv: csvDrug, db: dbUpper[csvDrug] });
    csvMatchedSet.add(csvDrug);
    dbMatchedSet.add(csvDrug);
    continue;
  }

  // Try base name
  const base = csvDrug.split(/[\s+&,]/)[0].trim();
  if (base.length >= 5) {
    const found = dbDrugs.find(
      (d) =>
        d.toUpperCase() === base ||
        d.toUpperCase().startsWith(base + " ") ||
        d.toUpperCase().startsWith(base + "-"),
    );
    if (found && !csvDrug.includes("&") && !csvDrug.includes("+")) {
      matched.push({ csv: csvDrug, db: found });
      csvMatchedSet.add(csvDrug);
      dbMatchedSet.add(found.toUpperCase());
      continue;
    }
  }

  // If still unmatched
  if (!csvMatchedSet.has(csvDrug)) {
    csvOnly.push(csvDrug);
  }
}

const dbOnly = dbDrugs.filter((d) => !dbMatchedSet.has(d.toUpperCase()));
matched.sort((a, b) => a.csv.localeCompare(b.csv));
csvOnly.sort();
dbOnly.sort();

function categorize(d) {
  if (/ISOFLU|PROPOFOL|THIOPENT|SEVOFLUR|BUPIVAC/.test(d))
    return "Anaesthetics";
  if (
    /TRAMADOL|PENTAZOC|BUTORPHAN|NALBUPH|PIROX|ACECLO|TRYPSIN|MEFAN|NAPROXEN|IBUPROFEN &/.test(
      d,
    )
  )
    return "Analgesics/NSAIDs";
  if (/CHLORPHEN|PHENIRA|LEVOCET|MONTELUKAST &/.test(d))
    return "Anti-allergics";
  if (/PREGAB|CLOBAZ|TRICLOF/.test(d)) return "Anticonvulsants";
  if (
    /NORFLOX|CEFPOD|CEFOPER|CEFUROX|CEFTAZ|FAROP|COLIST|FOSFO|TIGEC|FRAMYC|FUSID|NEOMYCIN|CLOTRIM.*BECL|BETAMETH.*(NEO|CLIOQ)/.test(
      d,
    )
  )
    return "Anti-infectives";
  if (/GLIC/.test(d)) return "Endocrine";
  if (/HEPARIN|ENOXAP|STREPTO/.test(d)) return "Coagulation";
  if (
    /METOP|TELMI|TORSE|RAMI|ROSUVAST|ATORVAST|LABETA|AMLODIP.*HYDRO|VASOPRES|TERLIP|MEPHEN/.test(
      d,
    )
  )
    return "Cardiovascular";
  if (
    /DOMP|DICYC|DROTAV|SIMETH|HYOSC|BISAC|LIQUID PAR|SODIUM PIC|BACILL|ANTAC|LOPER|ORAL RE/.test(
      d,
    )
  )
    return "GI medicines";
  if (/OXYTOC|PROGEST|CARBOP|CARBET|MISOPRO|VALET|NORETH/.test(d))
    return "Obstetric";
  if (/FLUOROMET|LOTEPR|TROPICAM|CARBOXYP|CROMOLYN|TOBRAM/.test(d))
    return "Ophthalmology";
  if (/CALAMINE|CLOBETS|BENZALK|POVIDON/.test(d)) return "Dermatology";
  if (/ATRACUR|NEOSTIG|VECURO|DEXMED|SUCCIN/.test(d)) return "Muscle relaxants";
  if (/ALPRAZ|BUSPI/.test(d)) return "Psychiatry";
  if (/THEOPH|LEVOSALB/.test(d)) return "Respiratory";
  if (
    /VACCINE|DPT|BCG|HEPAT|MEASEL|POLIO|ROTAV|VARIC|PNEUM|MENING|ENCEPH|ANTI RAB|ANTI D|TETNU|ANTI COLD/.test(
      d,
    )
  )
    return "Vaccines/Immunologicals";
  if (/VITAMIN|CALCIUM &|B-COMP|MULTI|L-ARG/.test(d))
    return "Vitamins/Minerals";
  if (/WATER|ISOLYTE|SODIUM CHLOR.*DEXT/.test(d)) return "IV fluids";
  if (/DISOD|ANTI ?SNAKE/.test(d)) return "Antidotes/Urology";
  if (/CARBI/.test(d)) return "Thyroid";
  if (/GLYCER|LIQUID PAR|MELATONIN|NIFEDIP.*LID|SULPH/.test(d))
    return "Miscellaneous";
  return "";
}

// Build markdown
let md = `# Formulary Comparison Report

**Date:** 2026-03-18

**Hospital Physical Formulary (CSV):** RADHIKA MEDICINE DRUG FORMULARY.csv
**Database Formulary:** Supabase \`formulary\` table (active drugs)

---

## Summary

| Metric | Count |
|--------|-------|
| Unique drugs in hospital CSV | ${csvDrugs.length} |
| Active drugs in database | ${dbDrugs.length} |
| Drugs matched (in both) | ${matched.length} |
| CSV drugs NOT in database (need to add) | ${csvOnly.length} |
| Database drugs NOT in CSV (pediatric/specialty) | ${dbOnly.length} |

---

## 1. Drugs in CSV but NOT in Database (${csvOnly.length} drugs to add)

These drugs are in the hospital's physical formulary but missing from the database and need to be added.

| # | CSV Drug Name | Category |
|---|--------------|----------|
`;
csvOnly.forEach((d, i) => {
  md += `| ${i + 1} | ${d} | ${categorize(d)} |\n`;
});

md += `
---

## 2. Drugs in BOTH Formularies (${matched.length} drugs matched)

| # | CSV Drug Name | Database Drug Name | Name Variation? |
|---|--------------|-------------------|-----------------|
`;
matched.forEach((m, i) => {
  const varied = m.csv !== m.db.toUpperCase() ? "Yes" : "";
  md += `| ${i + 1} | ${m.csv} | ${m.db} | ${varied} |\n`;
});

md += `
---

## 3. Drugs ONLY in Database (${dbOnly.length} drugs — pediatric/specialty)

These are primarily pediatric-specific, oncology, rare disease, and specialty drugs in the database not in the hospital's general formulary.

| # | Database Drug Name |
|---|-------------------|
`;
dbOnly.forEach((d, i) => {
  md += `| ${i + 1} | ${d} |\n`;
});

md += `
---

## Key Name Variations Detected

Spelling and naming differences found between the CSV and database:

| CSV Name | Database Name | Variation Type |
|----------|-------------|----------------|
| CETRIZINE | Cetirizine | Spelling |
| ONDASETRON | Ondansetron | Spelling |
| LIGNOCAINE | Lidocaine | Regional (Indian/BNF vs USAN) |
| ADERNALINE | Epinephrine | Regional naming |
| NORADRENALINE | Norepinephrine | Regional naming |
| GENTAMYCIN | Gentamicin | Spelling |
| GABAPENTINE | Gabapentin | Spelling |
| PHENOBARBITONE | Phenobarbital | Regional (BNF vs USP) |
| HYDROXICHLOROQUINE | Hydroxychloroquine | Spelling |
| ENALPRIL | Enalapril | Spelling |
| ACICLOVIR | Acyclovir | Regional (BAN vs USAN) |
| TERBINAFIN | Terbinafine | Spelling |
| CARVEDIOLOL | Carvedilol | Spelling |
| THYROXIN | Levothyroxine | Generic vs specific |
| METHYL PREDNISOLONE | Methylprednisolone | Spacing |
| METHYL COBALAMINE | Methylcobalamin | Spacing + spelling |
| PERMETHRINE | Permethrin | Spelling |
| SULPHUR | Precipitated sulfur | British vs American spelling |
| ACETYLSALICYLIC ACID | Aspirin | Chemical vs common name |
| SODIUM VALPROATE | Valproate | Salt vs base name |
| MAGNESIUM SULPHATE | Magnesium sulfate | British vs American |
| GLYCOPYROLATE | Glycopyrrolate | Spelling |
| PIPERACILLIN AND TAZOBACTUM | Piperacillin-tazobactam | Spelling + format |
`;

const outPath = path.join(__dirname, "..", "docs", "formulary_comparison.md");
fs.writeFileSync(outPath, md, "utf8");
console.log(
  `Done. Matched: ${matched.length} | CSV only: ${csvOnly.length} | DB only: ${dbOnly.length}`,
);
console.log(`Written to: ${outPath}`);
