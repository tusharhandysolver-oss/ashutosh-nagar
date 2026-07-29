-- Run this in the SQL editor of the same Supabase project configured in .env.
-- The existing bucket name is case-sensitive: Documents

update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]
where id = 'Documents';

create policy "Owners can upload Documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'Documents'
  and owner_id = (select auth.uid()::text)
);

create policy "Owners can read Documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'Documents'
  and owner_id = (select auth.uid()::text)
);

create policy "Owners can delete Documents"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'Documents'
  and owner_id = (select auth.uid()::text)
);
