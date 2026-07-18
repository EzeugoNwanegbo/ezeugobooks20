-- Med/Law focus: G&D is specialising for medical and law students. `discipline`
-- is the primary axis that switches the AI's reasoning framework (clinical
-- reasoning vs legal IRAC), and `study_track` is the sub-track within it
-- (e.g. pre-clinical/clinical for medicine, LLB/bar for law).
alter table public.user_profiles
add column if not exists discipline text;

alter table public.user_profiles
add column if not exists study_track text;
