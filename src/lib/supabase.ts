import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://sfbxpscbevnmoppgkjcr.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmYnhwc2NiZXZubW9wcGdramNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMTQ3OTQsImV4cCI6MjEwMTY5MDc5NH0.ttfR2pNVqlOYrorGdAs7aaGgufxwXIsG-GXvLDd-jZw";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export { supabaseUrl };
