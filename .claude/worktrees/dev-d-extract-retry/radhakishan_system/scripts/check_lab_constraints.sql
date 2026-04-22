SELECT conname, pg_get_constraintdef(c.oid) as constraint_def
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
WHERE t.relname = 'lab_results' AND c.contype = 'c';
