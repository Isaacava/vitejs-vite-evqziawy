import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../src/lib/intent.js";
import { readAgentOnchainStats, type OnchainAgentStats } from "../src/server/testnetOnchain.js";

type CachedOnchainStats = {