import type { SupabaseClient } from "@supabase/supabase-js";

export async function recordUserActivity(
  supabase: SupabaseClient,
  input: {
    userId?: string | null;
    missionId?: string | null;
    jobId?: string | null;
    type: string;
    title: string;
    description?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  if (!input.userId) return;
  await supabase.from("user_activity").insert({
    user_id: input.userId,
    mission_id: input.missionId || null,
    job_id: input.jobId || null,
    type: input.type,
    title: input.title,
    description: input.description || null,
    metadata: input.metadata || {},
  });
}
