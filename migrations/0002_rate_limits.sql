-- Fixed 10-minute windows for public booking confirms.
-- `key` is the route name plus a SHA-256 of the client IP. Raw IPs are not stored.
-- Old windows are deleted during requests (anything older than a day).

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (key, window_start)
);

create index rate_limits_window_start_idx on rate_limits (window_start);
