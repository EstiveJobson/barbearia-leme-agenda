-- Bumped whenever that owner's password changes so older session cookies stop working.

alter table owner_accounts
  add column session_version integer not null default 1;
