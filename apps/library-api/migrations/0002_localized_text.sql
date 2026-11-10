-- equipe-design library: style descriptions in every equipe.im language (T-722).
-- `description` stays English (the fallback); `description_i18n` holds the others: {"ko": "...", "ja": "...", ...}.
-- Limit texts need no column: they live in releases.detail (ReleaseBody.limits[].textI18n).

alter table styles
  add column description_i18n jsonb not null default '{}'
  check (jsonb_typeof(description_i18n) = 'object'
         and description_i18n - array['ko', 'ja', 'zh-CN', 'de', 'fr', 'es', 'pt-BR'] = '{}'::jsonb);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_ro') then
    grant select (description_i18n) on styles to api_ro;
  end if;
end $$;
