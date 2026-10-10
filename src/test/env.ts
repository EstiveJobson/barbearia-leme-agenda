// Slot tests must hit the embedded PGLite fallback, never a configured Neon URL.
delete process.env.DATABASE_URL;
