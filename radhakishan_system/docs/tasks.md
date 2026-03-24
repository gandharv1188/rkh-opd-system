STILL REMAINING:

#: 1
Task: Dosing bands
Scope: All 679 drugs — currently empty []
Source: IAP Drug Formulary 2024, BNFC, Nelson's
────────────────────────────────────────
#: 2
Task: ~28 suspect brand matches
Scope: Branded drugs where SNOMED brand data doesn't match the

    drug (e.g., Alpha-lipoic acid → Montelukast brands)

Source: Manual review / re-match
────────────────────────────────────────
#: 3
Task: Frontend update
Scope: prescription-pad.html calcDose() and formulary pages  
 still read old conc_qty/conc_unit format — need to read new
ingredients[] structure
Source: Code change
────────────────────────────────────────
#: 4
Task: Edge Function update
Scope: generate-prescription tool get_formulary returns DB  
 rows
— needs to handle new ABDM FHIR formulation structure in  
 Claude's context
Source: Code change
────────────────────────────────────────
#: 5
Task: Standard prescriptions sync
Scope: The 24+446 protocols reference drug names — verify they

    still match generic_name in the new formulary

Source: Validation script
────────────────────────────────────────
#: 6
Task: 53 orphans
Scope: Could manually add SNOMED codes for common ones  
 (vaccines, combos) that the auto-matcher missed
Source: Manual or web search
────────────────────────────────────────
#: 7
Task: 173 generics
Scope: Old-format formulations with basic conc_qty data —  
 could
enrich if SNOMED International has data
Source: SNOMED International
────────────────────────────────────────
#: 8
Task: Import to Supabase Storage
Scope: Skill files and web pages — unrelated to formulary but
pending from earlier
Source: Upload
