drop extension if exists "pg_net";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.set_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  return new;
end $function$
;


