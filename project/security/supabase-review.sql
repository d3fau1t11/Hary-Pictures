-- READ ONLY: run in the Supabase SQL editor to inspect backend authorization.
-- An empty public API response alone cannot prove that RLS is enabled.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname = 'public' AND c.relname IN
       ('categories', 'pictures', 'profile_settings', 'contact_messages'))
   OR (n.nspname = 'storage' AND c.relname = 'objects');

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN
       ('categories', 'pictures', 'profile_settings', 'contact_messages'))
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE grantee IN ('anon', 'authenticated')
  AND table_schema IN ('public', 'storage')
ORDER BY table_schema, table_name, grantee, privilege_type;

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'pictures';
