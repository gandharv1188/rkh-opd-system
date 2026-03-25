# Formulary Comparison Report

**Date:** 2026-03-18

**Hospital Physical Formulary (CSV):** RADHIKA MEDICINE DRUG FORMULARY.csv
**Database Formulary:** Supabase `formulary` table (active drugs)

---

## Summary

| Metric                                          | Count |
| ----------------------------------------------- | ----- |
| Unique drugs in hospital CSV                    | 262   |
| Active drugs in database                        | 530   |
| Drugs matched (in both)                         | 140   |
| CSV drugs NOT in database (need to add)         | 122   |
| Database drugs NOT in CSV (pediatric/specialty) | 394   |

---

## 1. Drugs in CSV but NOT in Database (122 drugs to add)

These drugs are in the hospital's physical formulary but missing from the database and need to be added.

| #   | CSV Drug Name                                                                | Category                |
| --- | ---------------------------------------------------------------------------- | ----------------------- |
| 1   | ACECLOFENAC 100 MG                                                           | Analgesics/NSAIDs       |
| 2   | ACECLOFENAC+PARACETAMOL+ SERRATIOPEPTIDASE                                   | Analgesics/NSAIDs       |
| 3   | ALPRAZOLAM                                                                   | Psychiatry              |
| 4   | AMLODIPINE+HYDROCHLOROTHIAZIDE                                               | Cardiovascular          |
| 5   | ANTACID                                                                      | GI medicines            |
| 6   | ANTI COLD SYRUP                                                              | Vaccines/Immunologicals |
| 7   | ANTI D                                                                       | Vaccines/Immunologicals |
| 8   | ANTISNAKE VENOM (POLYVALENT SOLUTION)(DRY POWDER)                            | Antidotes/Urology       |
| 9   | ATORVASTATIN                                                                 | Cardiovascular          |
| 10  | ATRACURIUM                                                                   | Muscle relaxants        |
| 11  | B-COMPLEX                                                                    | Vitamins/Minerals       |
| 12  | BACILLUS CLAUSII                                                             | GI medicines            |
| 13  | BCG VACCINE                                                                  | Vaccines/Immunologicals |
| 14  | BENZALKONIUM & ZINC                                                          | Dermatology             |
| 15  | BETAMETHASONE & CLIOQUINOL                                                   | Anti-infectives         |
| 16  | BETAMETHASONE & NEOMYCIN                                                     | Anti-infectives         |
| 17  | BISACODYL                                                                    | GI medicines            |
| 18  | BUPIVACAINE HYDROCHLORIDE IP                                                 | Anaesthetics            |
| 19  | BUSPIRON                                                                     | Psychiatry              |
| 20  | BUTORPHANOL TARTRATE                                                         | Analgesics/NSAIDs       |
| 21  | CALAMINE                                                                     | Dermatology             |
| 22  | CALCIUM & VITAMIN D3                                                         | Vitamins/Minerals       |
| 23  | CARBETOCIN                                                                   | Obstetric               |
| 24  | CARBIMAZOLE                                                                  | Thyroid                 |
| 25  | CARBOPROST                                                                   | Obstetric               |
| 26  | CEFOPERAZONE +SULBACTUM                                                      | Anti-infectives         |
| 27  | CEFPODOXIME                                                                  | Anti-infectives         |
| 28  | CEFTAZIDIME                                                                  | Anti-infectives         |
| 29  | CEFUROXIME                                                                   | Anti-infectives         |
| 30  | CHLORPHENIRAMINE MALEATE                                                     | Anti-allergics          |
| 31  | CLOBAZAM                                                                     | Anticonvulsants         |
| 32  | CLOBETASONE                                                                  |                         |
| 33  | CLOBETASONE & MICONAZOLE                                                     |                         |
| 34  | CLOTRIMAZOLE & BECLOMETHASONE                                                | Anti-infectives         |
| 35  | COLISTIMETHATE SODIUM                                                        | Anti-infectives         |
| 36  | COLISTIN SULPHATE                                                            | Anti-infectives         |
| 37  | CROMOLYN SODIUM                                                              | Ophthalmology           |
| 38  | DEXMEDETOMIDINE                                                              | Muscle relaxants        |
| 39  | DICYCLOMINE                                                                  | GI medicines            |
| 40  | DISODIUM HYDROGEN CITRATE                                                    | Antidotes/Urology       |
| 41  | DOMPERIDONE                                                                  | GI medicines            |
| 42  | DPT                                                                          | Vaccines/Immunologicals |
| 43  | DROTAVARINE                                                                  | GI medicines            |
| 44  | ENOXAPARIN SODIUM                                                            | Coagulation             |
| 45  | FAROPENEM                                                                    | Anti-infectives         |
| 46  | FLUOROMETHOLONE                                                              | Ophthalmology           |
| 47  | FOSFOMYCIN                                                                   | Anti-infectives         |
| 48  | FRAMYCETIN                                                                   | Anti-infectives         |
| 49  | FUSIDIC ACID & HYDROCORTISONE ACETATE                                        | Anti-infectives         |
| 50  | GLICLAZIDE                                                                   | Endocrine               |
| 51  | GLYCEROL                                                                     | Miscellaneous           |
| 52  | HEPARIN SODIUM                                                               | Coagulation             |
| 53  | HEPATITIS-A                                                                  | Vaccines/Immunologicals |
| 54  | HEPATITIS-B                                                                  | Vaccines/Immunologicals |
| 55  | HEPATITIS-B (HUMAN IMMUNOGLOBIN )                                            | Vaccines/Immunologicals |
| 56  | HYOSCINE BUTYL BROMIDE                                                       | GI medicines            |
| 57  | IBUPROFEN & PARACETAMOL                                                      | Analgesics/NSAIDs       |
| 58  | ISOFLURANE                                                                   | Anaesthetics            |
| 59  | ISOLYTE-P                                                                    | IV fluids               |
| 60  | JAPANESE ENCEPHALITIS                                                        | Vaccines/Immunologicals |
| 61  | L-ARGININE                                                                   | Vitamins/Minerals       |
| 62  | LABETALOL                                                                    | Cardiovascular          |
| 63  | LEVOCETRIZINE                                                                | Anti-allergics          |
| 64  | LEVOSALBUTAMOL                                                               | Respiratory             |
| 65  | LIQUID PARAFFIN+MILK OF MAGNESIA                                             | GI medicines            |
| 66  | LIQUID PARAFIN                                                               | GI medicines            |
| 67  | LOTEPREDNOL ETABONATE                                                        | Ophthalmology           |
| 68  | MEASELS                                                                      | Vaccines/Immunologicals |
| 69  | MEFANAMIC ACID                                                               | Analgesics/NSAIDs       |
| 70  | MEFANAMIC ACID & PARACETAMOL                                                 | Analgesics/NSAIDs       |
| 71  | MENINGOCOCCAL (GROUP A,C,Y,W-135) POLYSACCHARIDE DIPHTHERIA TOXOID CONJUGATE | Vaccines/Immunologicals |
| 72  | MEPHENTERMINE                                                                | Cardiovascular          |
| 73  | METOPROLOL                                                                   | Cardiovascular          |
| 74  | MISOPROSTOL                                                                  | Obstetric               |
| 75  | MONTELUKAST & LEVOCETRIZINE                                                  | Anti-allergics          |
| 76  | MULTIVITAMINS,MULTIMINERALS,AMINO ACID & ANTIOXIDANT                         | Vitamins/Minerals       |
| 77  | NALBUPHINE                                                                   | Analgesics/NSAIDs       |
| 78  | NAPROXEN & DOMPERIDONE                                                       | Analgesics/NSAIDs       |
| 79  | NEOMYCIN,POLYMIXIN B & BACITRACIN ZINC                                       | Anti-infectives         |
| 80  | NEOSTIGMINE                                                                  | Muscle relaxants        |
| 81  | NORETHISTERONE                                                               | Obstetric               |
| 82  | NORFLOXACIN                                                                  | Anti-infectives         |
| 83  | ORAL POLIOMYELILIS                                                           | Vaccines/Immunologicals |
| 84  | ORAL REHYDRATION SALTS                                                       | GI medicines            |
| 85  | OXYTOCIN                                                                     | Obstetric               |
| 86  | PANTOPRAZOLE                                                                 |                         |
| 87  | PENTAZOCINE LACTATE                                                          | Analgesics/NSAIDs       |
| 88  | PHENIRAMINE MALEATE                                                          | Anti-allergics          |
| 89  | PIROXICAM                                                                    | Analgesics/NSAIDs       |
| 90  | PNEUMOCOCCAL POLYSACCHARIDE CONJUGATE                                        | Vaccines/Immunologicals |
| 91  | POVIDONE IODINE                                                              | Dermatology             |
| 92  | PREGABALIN & METHYLCOBALAMINE                                                | Anticonvulsants         |
| 93  | PROGESTRONE                                                                  | Obstetric               |
| 94  | PROPOFOL                                                                     | Anaesthetics            |
| 95  | RAMIPRIL                                                                     | Cardiovascular          |
| 96  | ROSUVASTATIN                                                                 | Cardiovascular          |
| 97  | ROTAVIRUS                                                                    | Vaccines/Immunologicals |
| 98  | SEVOFLURANCE WITH INDEXING COLLER USP                                        | Anaesthetics            |
| 99  | SIMETHICONE+DILLOIL+FENNELOIL                                                | GI medicines            |
| 100 | SODIUM CHLORIDE & DEXTROSE                                                   | IV fluids               |
| 101 | SODIUM PICOSULFATE                                                           | GI medicines            |
| 102 | STREPTOKINASE                                                                | Coagulation             |
| 103 | SUCCINYL CHOLINE VIAL                                                        | Muscle relaxants        |
| 104 | TELMISARTAN HCL                                                              | Cardiovascular          |
| 105 | TELMISARTAN HCL & AMLODIPINE                                                 | Cardiovascular          |
| 106 | TELMISARTAN+HYDROCHLOROTHIAZIDE+AMLODPINE                                    | Cardiovascular          |
| 107 | TERLIPRESSIN                                                                 | Cardiovascular          |
| 108 | TETNUS VACCINES                                                              | Vaccines/Immunologicals |
| 109 | THEOPHYLLINE ETOPHYLLINE                                                     | Respiratory             |
| 110 | THIOPENTONE SODIUM IP                                                        | Anaesthetics            |
| 111 | TIGECYCLINE                                                                  | Anti-infectives         |
| 112 | TOBRAMYCIN                                                                   | Ophthalmology           |
| 113 | TORSEMIDE                                                                    | Cardiovascular          |
| 114 | TRAMADOL HYDROCHLORIDE                                                       | Analgesics/NSAIDs       |
| 115 | TRICLOFOS                                                                    | Anticonvulsants         |
| 116 | TROPICAMIDE                                                                  | Ophthalmology           |
| 117 | TRYPSIN-CHYMOTRYPSIN                                                         | Analgesics/NSAIDs       |
| 118 | VALETHEMATE                                                                  | Obstetric               |
| 119 | VARICELLA                                                                    | Vaccines/Immunologicals |
| 120 | VASOPRESSIN                                                                  | Cardiovascular          |
| 121 | VECURONIUM BROMIDE POWDER                                                    | Muscle relaxants        |
| 122 | WATER FOR INJECTION                                                          | IV fluids               |

---

## 2. Drugs in BOTH Formularies (140 drugs matched)

| #   | CSV Drug Name                                                 | Database Drug Name                       | Name Variation? |
| --- | ------------------------------------------------------------- | ---------------------------------------- | --------------- |
| 1   | ACETAZOLAMIDE                                                 | Acetazolamide                            |                 |
| 2   | ACETYLSALICYLIC ACID                                          | Aspirin                                  | Yes             |
| 3   | ACICLOVIR                                                     | Acyclovir                                | Yes             |
| 4   | ADENOSINE                                                     | Adenosine                                |                 |
| 5   | ADERNALINE                                                    | Epinephrine                              | Yes             |
| 6   | ALBENDAZOLE                                                   | Albendazole                              |                 |
| 7   | ALPROSTADIL                                                   | Prostaglandin E1                         | Yes             |
| 8   | AMIKACIN                                                      | Amikacin                                 |                 |
| 9   | AMIODARONE HCL                                                | Amiodarone                               | Yes             |
| 10  | AMLODIPINE                                                    | Amlodipine                               |                 |
| 11  | AMOXICILLIN & POTASSIUM CLAVUNATE                             | Amoxicillin-Clavulanate                  | Yes             |
| 12  | ANTI RABIES                                                   | HRIG (Human Rabies Ig)                   | Yes             |
| 13  | ANTI RABIES IMMUNOGLOBULIN                                    | HRIG (Human Rabies Ig)                   | Yes             |
| 14  | ASCORBIC ACID(VITAMIN C)                                      | Vitamin C                                | Yes             |
| 15  | ATENOLOL                                                      | Atenolol                                 |                 |
| 16  | ATROPINE SULPHATE                                             | Atropine sulfate                         | Yes             |
| 17  | AZITHROMYCIN                                                  | Azithromycin                             |                 |
| 18  | BACLOFEN                                                      | Baclofen                                 |                 |
| 19  | BETAMETHASONE                                                 | Betamethasone 0.05%                      | Yes             |
| 20  | BOSENTAN                                                      | Bosentan                                 |                 |
| 21  | BUDESONIDE                                                    | Budesonide                               |                 |
| 22  | CAFFEINE CITRATE                                              | Caffeine citrate                         |                 |
| 23  | CALCIUM CARBONATE                                             | Calcium carbonate                        |                 |
| 24  | CALCIUM GLUCONATE                                             | Calcium Gluconate 10%                    | Yes             |
| 25  | CARBAMAZEPINE                                                 | Carbamazepine                            |                 |
| 26  | CARBOXYPROPYLMEHTYLCELLULOSE                                  | Artificial tears (preservative-free)     | Yes             |
| 27  | CARVEDIOLOL                                                   | Carvedilol                               | Yes             |
| 28  | CEFIXIME                                                      | Cefixime                                 |                 |
| 29  | CEFOTAXIME                                                    | Cefotaxime                               |                 |
| 30  | CEFTRIAXONE                                                   | Ceftriaxone                              |                 |
| 31  | CETRIZINE                                                     | Cetirizine                               | Yes             |
| 32  | CHOLECALCIFEROL                                               | Cholecalciferol                          |                 |
| 33  | CIPROFLOXACIN                                                 | Ciprofloxacin                            |                 |
| 34  | CLINDAMYCIN                                                   | Clindamycin                              |                 |
| 35  | CLOBAETASOL PROPIONATE,NEOMYCIN SULPHATE & MICONAZOLE NITRATE | Clobetasol propionate 0.05%              | Yes             |
| 36  | CLONAZEPAM                                                    | Clonazepam                               |                 |
| 37  | CLOTRIMAZOLE                                                  | Clotrimazole 1% cream                    | Yes             |
| 38  | CROTAMITON                                                    | Crotamiton 10% cream                     | Yes             |
| 39  | DEXAMETHASONE                                                 | Dexamethasone                            |                 |
| 40  | DEXTROMETHORPHANE HYDROBROMIDE SYRUP                          | Dextromethorphan                         | Yes             |
| 41  | DEXTROSE                                                      | Dextrose 10%                             | Yes             |
| 42  | DIAZEPAM IP                                                   | Diazepam                                 | Yes             |
| 43  | DICLOFENAC                                                    | Diclofenac                               |                 |
| 44  | DIGOXIN                                                       | Digoxin                                  |                 |
| 45  | DOPAMINE                                                      | Dopamine                                 |                 |
| 46  | DOXYCYCLINE                                                   | Doxycycline                              |                 |
| 47  | ENALPRIL                                                      | Enalapril                                | Yes             |
| 48  | ESCITALOPRAM                                                  | Escitalopram                             |                 |
| 49  | ESOMEPRAZOLE                                                  | Esomeprazole                             |                 |
| 50  | FENTANYL IP                                                   | Fentanyl                                 | Yes             |
| 51  | FERRIC CARBOXYMALTOSE                                         | IV iron (ferric carboxymaltose)          | Yes             |
| 52  | FERROUS ASCORBATE & FOLIC ACID                                | Ferrous sulfate                          | Yes             |
| 53  | FERROUS FUMARATE & FOLIC ACID                                 | Ferrous fumarate                         | Yes             |
| 54  | FEXOFENADINE HCL                                              | Fexofenadine                             | Yes             |
| 55  | FLUCONAZOLE                                                   | Fluconazole                              |                 |
| 56  | FLUOXETINE                                                    | Fluoxetine                               |                 |
| 57  | FLUTICASONE                                                   | Fluticasone propionate nasal spray       | Yes             |
| 58  | FOLIC ACID                                                    | Folic acid                               |                 |
| 59  | FUROSEMIDE                                                    | Furosemide                               |                 |
| 60  | GABAPENTINE                                                   | Gabapentin                               | Yes             |
| 61  | GENTAMYCIN                                                    | Gentamicin                               | Yes             |
| 62  | GLYCOPYROLATE OSP                                             | Glycopyrrolate                           | Yes             |
| 63  | HUMAN ALBUMIN                                                 | Albumin 5%                               | Yes             |
| 64  | HYDROCORTISONE                                                | Hydrocortisone                           |                 |
| 65  | HYDROGEN PEROXIDE SOLUTION                                    | Hydrogen peroxide 1.5% rinse             | Yes             |
| 66  | HYDROXICHLOROQUINE                                            | Hydroxychloroquine                       | Yes             |
| 67  | HYDROXYZINE                                                   | Hydroxyzine                              |                 |
| 68  | IBUPROFEN                                                     | Ibuprofen                                |                 |
| 69  | INSULIN                                                       | Insulin (Regular)                        | Yes             |
| 70  | IPRATROPIUM BROMIDE RESPULES                                  | Ipratropium bromide                      | Yes             |
| 71  | IRON SUCROSE                                                  | IV iron (ferric carboxymaltose)          | Yes             |
| 72  | ISONIAZID                                                     | Isoniazid (H)                            | Yes             |
| 73  | ITRACONAZOLE                                                  | Itraconazole oral                        | Yes             |
| 74  | IVERMECTIN                                                    | Ivermectin                               |                 |
| 75  | KETAMINE HYDROCHLORIDE                                        | Ketamine                                 | Yes             |
| 76  | KETOCONAZOLE                                                  | Ketoconazole 2% cream                    | Yes             |
| 77  | LACTULOSE                                                     | Lactulose                                |                 |
| 78  | LEVETIRACETAM                                                 | Levetiracetam                            |                 |
| 79  | LEVOFLOXACIN                                                  | Levofloxacin                             |                 |
| 80  | LIGNOCAINE HYDROCHLORIDE                                      | Lidocaine 1%                             | Yes             |
| 81  | LIGNOCAINE HYDROCHLORIDE+ADRENALINE                           | Lidocaine 1%                             | Yes             |
| 82  | LINEZOLID                                                     | Linezolid                                |                 |
| 83  | LIPOSOMAL AMPHOTERICIN B                                      | Amphotericin B                           | Yes             |
| 84  | LOPERAMIDE                                                    | Loperamide                               |                 |
| 85  | LORAZEPAM                                                     | Lorazepam                                |                 |
| 86  | MAGNESIUM SULPHATE                                            | Magnesium sulfate                        | Yes             |
| 87  | MANNITOL                                                      | Mannitol                                 |                 |
| 88  | MELATONIN                                                     | Melatonin                                |                 |
| 89  | MEROPENEM INJECTION                                           | Meropenem                                | Yes             |
| 90  | METFORMIN                                                     | Metformin                                |                 |
| 91  | METHYL COBALAMINE                                             | Methylcobalamin                          | Yes             |
| 92  | METHYL PREDNISOLONE                                           | Methylprednisolone                       | Yes             |
| 93  | METOCLOPRAMIDE                                                | Metoclopramide                           |                 |
| 94  | METRONIDAZOLE                                                 | Metronidazole                            |                 |
| 95  | MIDAZOLAM                                                     | Midazolam                                |                 |
| 96  | MILRINONE LACTATE                                             | Milrinone                                | Yes             |
| 97  | MOMETASONE FUROATE                                            | Mometasone                               | Yes             |
| 98  | MONTELUKAST                                                   | Montelukast                              |                 |
| 99  | MOXIFLOXACIN                                                  | Moxifloxacin (ophthalmic)                | Yes             |
| 100 | MUPIROCIN                                                     | Mupirocin                                |                 |
| 101 | NALOXONE                                                      | Naloxone                                 |                 |
| 102 | NEOMYCIN & POLYMIXIN B, BACITRACIN ZINC & HYDROCORTISONE      | Neomycin/Polymyxin B/Hydrocortisone otic | Yes             |
| 103 | NIFEDIPINE+LIDOCAINE                                          | Nifedipine                               | Yes             |
| 104 | NITROFURANTOIN                                                | Nitrofurantoin                           |                 |
| 105 | NORADRENALINE                                                 | Norepinephrine                           | Yes             |
| 106 | OFLOXACIN                                                     | Ofloxacin 0.3% otic                      | Yes             |
| 107 | ONDASETRON                                                    | Ondansetron                              | Yes             |
| 108 | PARACETAMOL                                                   | Paracetamol                              |                 |
| 109 | PERMETHRINE                                                   | Permethrin 5% cream                      | Yes             |
| 110 | PHENOBARBITONE                                                | Phenobarbital                            | Yes             |
| 111 | PHENYTOIN                                                     | Phenytoin                                |                 |
| 112 | PIPERACILLIN AND TAZOBACTUM                                   | Piperacillin-tazobactam                  | Yes             |
| 113 | POTASSIUM CHLORIDE                                            | Potassium citrate                        | Yes             |
| 114 | POTASSIUM CITRATE & CITRIC ACID                               | Potassium citrate                        | Yes             |
| 115 | PREDNISOLONE                                                  | Prednisolone                             |                 |
| 116 | PROMETHAZINE                                                  | Promethazine                             |                 |
| 117 | PROPRANOLOL                                                   | Propranolol                              |                 |
| 118 | PYRAZINAMIDE                                                  | Pyrazinamide (Z)                         | Yes             |
| 119 | RANITIDINE                                                    | Ranitidine/Famotidine                    | Yes             |
| 120 | RIFAMPICIN                                                    | Rifampicin                               |                 |
| 121 | RINGER'S LACTATE                                              | Lactated Ringer                          | Yes             |
| 122 | SALBUTAMOL                                                    | Salbutamol (Albuterol)                   | Yes             |
| 123 | SALINE NASAL SOLUTION                                         | Nasal saline drops/spray                 | Yes             |
| 124 | SILDENAFIL                                                    | Sildenafil                               |                 |
| 125 | SODIUM BICARBONATE                                            | Sodium Bicarbonate                       |                 |
| 126 | SODIUM CHLORIDE                                               | Normal Saline (0.9% Sodium Chloride)     | Yes             |
| 127 | SODIUM VALPROATE                                              | Valproate                                | Yes             |
| 128 | SUCRALFATE                                                    | Sucralfate                               |                 |
| 129 | SULPHUR                                                       | Precipitated sulfur 5-10%                | Yes             |
| 130 | TAMSULOSIN                                                    | Tamsulosin                               |                 |
| 131 | TERBINAFIN                                                    | Terbinafine                              | Yes             |
| 132 | THIAMINE                                                      | Thiamine                                 |                 |
| 133 | THYROXIN                                                      | Levothyroxine                            | Yes             |
| 134 | TRANEXAMIC ACID                                               | Tranexamic Acid                          |                 |
| 135 | URSODEOXYCHOLIC ACID                                          | Ursodeoxycholic acid                     |                 |
| 136 | VANCOMYCIN INJECTION                                          | Vancomycin                               | Yes             |
| 137 | VITAMIN A                                                     | Vitamin A                                |                 |
| 138 | VITAMIN E                                                     | Vitamin E                                |                 |
| 139 | VITAMIN K                                                     | Phytonadione (Vitamin K1)                | Yes             |
| 140 | ZINC SULPHATE                                                 | Zinc sulfate                             | Yes             |

---

## 3. Drugs ONLY in Database (394 drugs — pediatric/specialty)

These are primarily pediatric-specific, oncology, rare disease, and specialty drugs in the database not in the hospital's general formulary.

| #   | Database Drug Name                           |
| --- | -------------------------------------------- |
| 1   | Abacavir/Lamivudine                          |
| 2   | Abatacept                                    |
| 3   | Acetic acid 2% otic solution                 |
| 4   | Actinomycin D + Vincristine (EE-4A)          |
| 5   | Adalimumab                                   |
| 6   | Adapalene 0.1% gel                           |
| 7   | Albumin + Furosemide                         |
| 8   | Allopurinol                                  |
| 9   | Almotriptan                                  |
| 10  | Alpha-lipoic acid                            |
| 11  | Alternating acetaminophen/ibuprofen          |
| 12  | Aminophylline                                |
| 13  | Amitriptyline                                |
| 14  | Amoxicillin                                  |
| 15  | Ampicillin                                   |
| 16  | Ampicillin + Gentamicin                      |
| 17  | Ampicillin-sulbactam                         |
| 18  | Anakinra                                     |
| 19  | Anhydrous lanolin                            |
| 20  | Apremilast                                   |
| 21  | Arimoclomol (NPC)                            |
| 22  | Aripiprazole                                 |
| 23  | Artemether-lumefantrine                      |
| 24  | Artesunate                                   |
| 25  | Artesunate-Pyronaridine                      |
| 26  | Artesunate-amodiaquine                       |
| 27  | Ataluren                                     |
| 28  | Atomoxetine                                  |
| 29  | Atropine                                     |
| 30  | Atropine 0.05% eye drops                     |
| 31  | Atropine 1% eye drops (penalization)         |
| 32  | Azathioprine                                 |
| 33  | Azelaic acid 15-20% cream                    |
| 34  | Azithromycin 1% ophthalmic                   |
| 35  | Azithromycin oral                            |
| 36  | Azithromycin prophylaxis                     |
| 37  | Bacitracin ointment                          |
| 38  | Baloxavir marboxil                           |
| 39  | Baloxavir marboxil (if influenza)            |
| 40  | Baricitinib                                  |
| 41  | Belimumab                                    |
| 42  | Benzathine penicillin G                      |
| 43  | Benzoyl peroxide 2.5-5%                      |
| 44  | Benztropine                                  |
| 45  | Betaine (trimethylglycine)                   |
| 46  | Betamethasone dipropionate 0.05%             |
| 47  | Bevacizumab                                  |
| 48  | Bismuth subsalicylate                        |
| 49  | Botulinum toxin A                            |
| 50  | Botulinum toxin A injection                  |
| 51  | Botulinum toxin injection                    |
| 52  | Brentuximab vedotin                          |
| 53  | Brentuximab vedotin (single)                 |
| 54  | Brentuximab vedotin + AVEPC                  |
| 55  | Budesonide (oral viscous)                    |
| 56  | Budesonide nebulized                         |
| 57  | Budesonide-Formoterol                        |
| 58  | CPX-351 (liposomal Ara-C/dauno)              |
| 59  | Calcipotriene 0.005% cream                   |
| 60  | Calcitriol                                   |
| 61  | Calcium gluconate (neonatal)                 |
| 62  | Canakinumab                                  |
| 63  | Captopril                                    |
| 64  | Carbamide peroxide 6.5%                      |
| 65  | Casgevy (exagamglogene autotemcel)           |
| 66  | Cefazolin                                    |
| 67  | Cefdinir                                     |
| 68  | Cefepime                                     |
| 69  | Cenobamate                                   |
| 70  | Cephalexin                                   |
| 71  | Chloramphenicol                              |
| 72  | Chlorhexidine gluconate 0.12%                |
| 73  | Chloroquine                                  |
| 74  | Cholestyramine                               |
| 75  | Ciclopirox 1% cream/shampoo                  |
| 76  | Ciclopirox 8% nail lacquer                   |
| 77  | Cidofovir                                    |
| 78  | Ciprofloxacin otic preparations              |
| 79  | Cisatracurium                                |
| 80  | Clarithromycin                               |
| 81  | Clindamycin 1% + Benzoyl peroxide 5% gel     |
| 82  | Clindamycin 1% lotion                        |
| 83  | Clonidine                                    |
| 84  | Clotrimazole troches                         |
| 85  | Coenzyme Q10                                 |
| 86  | Colchicine                                   |
| 87  | Colloid (Dextran 40)                         |
| 88  | Copper supplementation                       |
| 89  | Crinecerfont                                 |
| 90  | Crotalidae Polyvalent Immune Fab (CroFab)    |
| 91  | Cyanocobalamin                               |
| 92  | Cyanocobalamin (IM)                          |
| 93  | Cyclopentolate 1% ophthalmic                 |
| 94  | Cyclophosphamide                             |
| 95  | Cyclosporine                                 |
| 96  | Cyproheptadine                               |
| 97  | DHA-piperaquine                              |
| 98  | Dantrolene                                   |
| 99  | Darbepoetin                                  |
| 100 | Deferasirox                                  |
| 101 | Deferiprone                                  |
| 102 | Deferoxamine                                 |
| 103 | Deflazacort                                  |
| 104 | Denosumab                                    |
| 105 | Desloratadine                                |
| 106 | Desmopressin                                 |
| 107 | Dextrose gel 40%                             |
| 108 | Dextrose infusion                            |
| 109 | Diazoxide                                    |
| 110 | Diltiazem (topical)                          |
| 111 | Dimenhydrinate                               |
| 112 | Dimethicone 4% lotion                        |
| 113 | Diphenhydramine                              |
| 114 | Diphtheria antitoxin (DAT)                   |
| 115 | Dobutamine                                   |
| 116 | Docusate sodium 1% drops                     |
| 117 | Dolutegravir (DTG)                           |
| 118 | Dornase alfa                                 |
| 119 | Doxapram                                     |
| 120 | Doxorubicin                                  |
| 121 | Duloxetine                                   |
| 122 | Dupilumab                                    |
| 123 | EPO (erythropoietin)                         |
| 124 | Eculizumab                                   |
| 125 | Efavirenz                                    |
| 126 | Elexacaftor/tezacaftor/ivacaftor             |
| 127 | Eltrombopag                                  |
| 128 | Emapalumab                                   |
| 129 | Emicizumab                                   |
| 130 | Entecavir                                    |
| 131 | Epinephrine nasal spray (Neffy)              |
| 132 | Epoprostenol                                 |
| 133 | Equine RIG (ERIG)                            |
| 134 | Ergocalciferol (Vitamin D2)                  |
| 135 | Ertapenem                                    |
| 136 | Erythromycin                                 |
| 137 | Erythropoietin                               |
| 138 | Esmolol                                      |
| 139 | Estradiol                                    |
| 140 | Estradiol (transdermal)                      |
| 141 | Etanercept                                   |
| 142 | Eteplirsen                                   |
| 143 | Ethambutol                                   |
| 144 | Ethionamide                                  |
| 145 | Ethosuximide                                 |
| 146 | Etoposide                                    |
| 147 | Extended half-life FIX (rIX-FP)              |
| 148 | Factor IX                                    |
| 149 | Factor VIII                                  |
| 150 | Famciclovir                                  |
| 151 | Famotidine                                   |
| 152 | Fitusiran                                    |
| 153 | Flecainide                                   |
| 154 | Fludrocortisone                              |
| 155 | Flumazenil                                   |
| 156 | Fluocinonide                                 |
| 157 | Fluphenazine                                 |
| 158 | Fluticasone (swallowed)                      |
| 159 | Fluvoxamine                                  |
| 160 | Folic acid (parenteral)                      |
| 161 | Folic acid high-dose                         |
| 162 | Folinic Acid (Leucovorin)                    |
| 163 | Fomepizole                                   |
| 164 | Fortified tobramycin 1.4% + cefazolin 5%     |
| 165 | Foscarnet                                    |
| 166 | Fosphenytoin                                 |
| 167 | G-CSF (Filgrastim)                           |
| 168 | GH therapy (PWS)                             |
| 169 | Galsulfase (MPS VI)                          |
| 170 | Ganciclovir                                  |
| 171 | Gatifloxacin 0.5% ophthalmic                 |
| 172 | Gemtuzumab ozogamicin                        |
| 173 | Glecaprevir/pibrentasvir (Mavyret)           |
| 174 | Glucagon                                     |
| 175 | Glycerin suppositories                       |
| 176 | GnRH (Buserelin)                             |
| 177 | Griseofulvin microsize oral                  |
| 178 | Growth hormone therapy                       |
| 179 | Guanfacine                                   |
| 180 | Guanfacine ER                                |
| 181 | Histrelin implant                            |
| 182 | Human TIG                                    |
| 183 | Hyaluronidase-facilitated SCIG               |
| 184 | Hydrochlorothiazide                          |
| 185 | Hydrocortisone 0.5-1% cream                  |
| 186 | Hydrocortisone 1% cream                      |
| 187 | Hydrocortisone 2.5% cream                    |
| 188 | Hydroquinone 2-4% cream                      |
| 189 | Hydroxocobalamin (IM)                        |
| 190 | Hydroxyurea                                  |
| 191 | IV Artesunate                                |
| 192 | IV Hydrocortisone                            |
| 193 | IV methylprednisolone                        |
| 194 | IV pamidronate                               |
| 195 | IV zoledronic acid                           |
| 196 | IVIG                                         |
| 197 | Idursulfase                                  |
| 198 | Ifosfamide + Doxorubicin                     |
| 199 | Ifosfamide + Etoposide                       |
| 200 | Imiglucerase                                 |
| 201 | Imipramine                                   |
| 202 | Indomethacin                                 |
| 203 | Infliximab                                   |
| 204 | Inotuzumab ozogamicin                        |
| 205 | Insulin Aspart                               |
| 206 | Insulin Glargine                             |
| 207 | Intranasal Fluticasone                       |
| 208 | Intrapleural urokinase                       |
| 209 | Intrathecal baclofen                         |
| 210 | Intrathecal cytarabine                       |
| 211 | Iodoquinol                                   |
| 212 | Iron polymaltose (Fe3+)                      |
| 213 | Isotretinoin                                 |
| 214 | Ivacaftor (Kalydeco)                         |
| 215 | Ivermectin 0.5% lotion                       |
| 216 | Ketoconazole 2% shampoo                      |
| 217 | Ketorolac                                    |
| 218 | Ketotifen 0.025% ophthalmic (OTC)            |
| 219 | L-Carnitine                                  |
| 220 | Lactobacillus rhamnosus GG                   |
| 221 | Lamotrigine                                  |
| 222 | Lansoprazole                                 |
| 223 | Ledipasvir/sofosbuvir (Harvoni)              |
| 224 | Letrozole                                    |
| 225 | Leucovorin (folinic acid)                    |
| 226 | Leuprolide acetate                           |
| 227 | Levodopa/carbidopa                           |
| 228 | Lidocaine (viscous)                          |
| 229 | Lipid Emulsion 20%                           |
| 230 | Liraglutide (Saxenda)                        |
| 231 | Lisinopril                                   |
| 232 | Lithium                                      |
| 233 | Lopinavir/Ritonavir                          |
| 234 | Loratadine                                   |
| 235 | Losartan                                     |
| 236 | Lyfgenia (lovotibeglogene autotemcel)        |
| 237 | Macitentan                                   |
| 238 | Mafenide Acetate                             |
| 239 | Marstacimab                                  |
| 240 | Mavacamten                                   |
| 241 | Mebendazole                                  |
| 242 | Methadone                                    |
| 243 | Methimazole                                  |
| 244 | Methotrexate                                 |
| 245 | Methylphenidate                              |
| 246 | Micafungin                                   |
| 247 | Miconazole                                   |
| 248 | Miglustat                                    |
| 249 | Mirabegron                                   |
| 250 | Morphine                                     |
| 251 | Mycophenolate mofetil                        |
| 252 | N-Acetylcysteine (NAC)                       |
| 253 | Nafcillin                                    |
| 254 | Naproxen                                     |
| 255 | Natamycin                                    |
| 256 | Nebulized epinephrine                        |
| 257 | Nebulized hypertonic saline                  |
| 258 | Nelarabine                                   |
| 259 | Nirmatrelvir/Ritonavir                       |
| 260 | Nirsevimab                                   |
| 261 | Nitazoxanide                                 |
| 262 | Nivolumab                                    |
| 263 | Nystatin                                     |
| 264 | Obidoxime                                    |
| 265 | Octreotide                                   |
| 266 | Olopatadine                                  |
| 267 | Omalizumab                                   |
| 268 | Omaveloxolone                                |
| 269 | Omeprazole                                   |
| 270 | Oral Vitamin K (Phytomenadione)              |
| 271 | Orlistat                                     |
| 272 | Oseltamivir                                  |
| 273 | Oxandrolone                                  |
| 274 | Oxcarbazepine                                |
| 275 | Oxybutynin                                   |
| 276 | Oxymetazoline                                |
| 277 | PEG 3350 (Polyethylene Glycol)               |
| 278 | Palivizumab                                  |
| 279 | Pancreatic enzyme replacement (Pancrelipase) |
| 280 | Pancreatic enzymes (Pancrelipase) for CF     |
| 281 | Paromomycin                                  |
| 282 | Paromomycin (luminal agent)                  |
| 283 | Patiromer                                    |
| 284 | Pegfilgrastim                                |
| 285 | Pegvaliase                                   |
| 286 | Penicillin G (Benzylpenicillin)              |
| 287 | Penicillin G procaine                        |
| 288 | Penicillin V                                 |
| 289 | Penicillin V (prophylaxis)                   |
| 290 | Pentobarbital                                |
| 291 | Peppermint oil (enteric-coated)              |
| 292 | Peramivir                                    |
| 293 | Permethrin 1% lotion                         |
| 294 | Petrolatum barrier ointment                  |
| 295 | Petroleum jelly (Vaseline)                   |
| 296 | Phentermine/topiramate                       |
| 297 | Phytonadione                                 |
| 298 | Pimecrolimus 1% cream                        |
| 299 | Pivmecillinam                                |
| 300 | Polyethylene Glycol 3350 (MiraLAX)           |
| 301 | Polymyxin B-Trimethoprim drops               |
| 302 | Potassium iodide                             |
| 303 | Potassium phosphate                          |
| 304 | Pralidoxime (2-PAM)                          |
| 305 | Pravastatin                                  |
| 306 | Praziquantel                                 |
| 307 | Prednis(ol)one                               |
| 308 | Prednisone                                   |
| 309 | Primaquine (radical cure)                    |
| 310 | Probiotics (LGG)                             |
| 311 | Probiotics (S. boulardii)                    |
| 312 | Probiotics (prevention)                      |
| 313 | Proparacaine                                 |
| 314 | Proton Pump Inhibitor                        |
| 315 | Pyrantel pamoate                             |
| 316 | Pyridostigmine                               |
| 317 | Pyridoxine (B6)                              |
| 318 | Pyridoxine (vitamin B6)                      |
| 319 | Pyrimethamine                                |
| 320 | Quinine                                      |
| 321 | Racecadotril                                 |
| 322 | Radioactive iodine (I-131)                   |
| 323 | Raltegravir                                  |
| 324 | Rasburicase                                  |
| 325 | Recombinant Factor VIIa                      |
| 326 | Regular insulin IV infusion                  |
| 327 | Remdesivir                                   |
| 328 | Retinol (Vitamin A)                          |
| 329 | Ribavirin                                    |
| 330 | Riboflavin (Vitamin B2)                      |
| 331 | Rilonacept                                   |
| 332 | Riluzole                                     |
| 333 | Risedronate                                  |
| 334 | Risperidone                                  |
| 335 | Rituximab                                    |
| 336 | Rizatriptan                                  |
| 337 | Romiplostim                                  |
| 338 | Ruxolitinib cream 1.5%                       |
| 339 | Saccharomyces boulardii                      |
| 340 | Sacubitril-Valsartan                         |
| 341 | Sapropterin (BH4)                            |
| 342 | Sarecycline                                  |
| 343 | Selenium sulfide 2.5%                        |
| 344 | Selexipag                                    |
| 345 | Semaglutide                                  |
| 346 | Senna (Sennosides)                           |
| 347 | Sertraline                                   |
| 348 | Sevelamer                                    |
| 349 | Silver Sulfadiazine 1%                       |
| 350 | Sirolimus                                    |
| 351 | Sodium Polystyrene Sulfonate                 |
| 352 | Sodium bicarbonate ear drops 5%              |
| 353 | Sofosbuvir/Velpatasvir                       |
| 354 | Somatropin                                   |
| 355 | Sotalol                                      |
| 356 | Spinosad 0.9% topical                        |
| 357 | Spironolactone                               |
| 358 | Sulfadiazine                                 |
| 359 | Sulfasalazine                                |
| 360 | Sumatriptan                                  |
| 361 | Surfactant (Poractant alfa)                  |
| 362 | TMP-SMX (Cotrimoxazole)                      |
| 363 | Tacrolimus                                   |
| 364 | Tafenoquine                                  |
| 365 | Temozolomide                                 |
| 366 | Tenofovir DF/Emtricitabine                   |
| 367 | Tenofovir disoproxil                         |
| 368 | Terbutaline                                  |
| 369 | Testosterone                                 |
| 370 | Tetrabenazine                                |
| 371 | Tinidazole                                   |
| 372 | Tizanidine                                   |
| 373 | Tocilizumab                                  |
| 374 | Tofacitinib                                  |
| 375 | Tolterodine                                  |
| 376 | Tolvaptan                                    |
| 377 | Topiramate                                   |
| 378 | Trazodone                                    |
| 379 | Treprostinil                                 |
| 380 | Triamcinolone                                |
| 381 | Trihexyphenidyl                              |
| 382 | Triptorelin                                  |
| 383 | Tris-Hydroxymethyl Aminomethane              |
| 384 | Ustekinumab                                  |
| 385 | Valacyclovir                                 |
| 386 | Valbenazine                                  |
| 387 | Valganciclovir                               |
| 388 | Velaglucerase alfa                           |
| 389 | Voclosporin                                  |
| 390 | Voriconazole                                 |
| 391 | Warfarin                                     |
| 392 | Zanamivir                                    |
| 393 | Zinc oxide ointment                          |
| 394 | Zinc pyrithione 1% shampoo                   |

---

## Key Name Variations Detected

Spelling and naming differences found between the CSV and database:

| CSV Name                    | Database Name           | Variation Type                |
| --------------------------- | ----------------------- | ----------------------------- |
| CETRIZINE                   | Cetirizine              | Spelling                      |
| ONDASETRON                  | Ondansetron             | Spelling                      |
| LIGNOCAINE                  | Lidocaine               | Regional (Indian/BNF vs USAN) |
| ADERNALINE                  | Epinephrine             | Regional naming               |
| NORADRENALINE               | Norepinephrine          | Regional naming               |
| GENTAMYCIN                  | Gentamicin              | Spelling                      |
| GABAPENTINE                 | Gabapentin              | Spelling                      |
| PHENOBARBITONE              | Phenobarbital           | Regional (BNF vs USP)         |
| HYDROXICHLOROQUINE          | Hydroxychloroquine      | Spelling                      |
| ENALPRIL                    | Enalapril               | Spelling                      |
| ACICLOVIR                   | Acyclovir               | Regional (BAN vs USAN)        |
| TERBINAFIN                  | Terbinafine             | Spelling                      |
| CARVEDIOLOL                 | Carvedilol              | Spelling                      |
| THYROXIN                    | Levothyroxine           | Generic vs specific           |
| METHYL PREDNISOLONE         | Methylprednisolone      | Spacing                       |
| METHYL COBALAMINE           | Methylcobalamin         | Spacing + spelling            |
| PERMETHRINE                 | Permethrin              | Spelling                      |
| SULPHUR                     | Precipitated sulfur     | British vs American spelling  |
| ACETYLSALICYLIC ACID        | Aspirin                 | Chemical vs common name       |
| SODIUM VALPROATE            | Valproate               | Salt vs base name             |
| MAGNESIUM SULPHATE          | Magnesium sulfate       | British vs American           |
| GLYCOPYROLATE               | Glycopyrrolate          | Spelling                      |
| PIPERACILLIN AND TAZOBACTUM | Piperacillin-tazobactam | Spelling + format             |
