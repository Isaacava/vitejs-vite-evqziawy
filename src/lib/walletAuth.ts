import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { BSC_RPC_URL } from "./network";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: (args?: { chains?: number[] }) => Promise<void>;
  connected?: boolean;
};

declare global { interface Window { ethereum?: Eip1193Provider } }

export type AuthUser = { id:string; wallet_address:string; display_name:string|null; avatar_url:string|null; created_at:string; updated_at:string };
export const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";
export const AUTH_CHAIN_ID = 97;
const AUTH_CHAIN_ID_HEX = `0x${AUTH_CHAIN_ID.toString(16)}`;
const TESTNET_WALLETCONNECT_STORAGE = "agentmarket-testnet-wc-v5";
const TESTNET_CHAIN_CONFIG = { chainId: AUTH_CHAIN_ID_HEX, chainName: "BNB Smart Chain Testnet", nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 }, rpcUrls: [BSC_RPC_URL], blockExplorerUrls: ["https://testnet.bscscan.com"] };
const AUTH_API = "/api/auth";
let walletProvider:Eip1193Provider|null=null;
let walletConnectInitPromise:Promise<Eip1193Provider>|null=null;

async function getChainId(provider:Eip1193Provider){ return String(await provider.request({method:"eth_chainId"})).toLowerCase(); }
async function disconnectWalletConnectSession(provider:Eip1193Provider|null){ try{await provider?.disconnect?.()}catch{} walletProvider=null; walletConnectInitPromise=null; }
async function createTestnetProvider(forceFresh=false):Promise<Eip1193Provider>{
  if(!forceFresh && walletConnectInitPromise) return walletConnectInitPromise;
  walletConnectInitPromise=EthereumProvider.init({projectId:WALLETCONNECT_PROJECT_ID,chains:[AUTH_CHAIN_ID],showQrModal:true,customStoragePrefix:TESTNET_WALLETCONNECT_STORAGE,rpcMap:{[AUTH_CHAIN_ID]:BSC_RPC_URL},metadata:{name:"AgentMarket Testnet",description:"AgentMarket BSC Testnet marketplace",url:window.location.origin,icons:[]}}).then(p=>p as unknown as Eip1193Provider);
  try{return await walletConnectInitPromise}catch(e){walletConnectInitPromise=null;throw e}
}
async function getWalletProvider(){ return walletProvider || createTestnetProvider(); }
async function ensureExpectedChain(provider:Eip1193Provider){
  let chainId=await getChainId(provider); if(chainId===AUTH_CHAIN_ID_HEX)return;
  try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:AUTH_CHAIN_ID_HEX}]})}
  catch(error){const code=typeof error==="object"&&error&&"code" in error?Number((error as {code?:unknown}).code):0; if(code!==4902) throw new Error("Your wallet is not on BSC Testnet (chain 97). Approve the network switch when WalletConnect prompts you."); await provider.request({method:"wallet_addEthereumChain",params:[TESTNET_CHAIN_CONFIG]})}
  chainId=await getChainId(provider); if(chainId!==AUTH_CHAIN_ID_HEX) throw new Error("WalletConnect is connected, but the wallet is still not on BSC Testnet (chain 97). Switch to BSC Testnet and try again.");
}
export async function connectWallet(){
  let provider=await getWalletProvider();
  try{
    if(provider.connect) await provider.connect({chains:[AUTH_CHAIN_ID]}); else await provider.request({method:"eth_requestAccounts"});
    await ensureExpectedChain(provider);
  }catch(firstError){
    await disconnectWalletConnectSession(provider); provider=await createTestnetProvider(true);
    if(provider.connect) await provider.connect({chains:[AUTH_CHAIN_ID]}); else await provider.request({method:"eth_requestAccounts"});
    try{await ensureExpectedChain(provider)}catch(secondError){throw new Error(secondError instanceof Error?secondError.message:firstError instanceof Error?firstError.message:"Unable to connect wallet to BSC Testnet.")}
  }
  const accounts=(await provider.request({method:"eth_accounts"})) as string[]; const wallet=accounts?.[0]; if(!wallet) throw new Error("No Testnet wallet account was selected."); walletProvider=provider; return {provider,address:wallet};
}
export async function ensureWalletConnectedProvider(){return connectWallet()}
export function getConnectedWalletProvider(){if(!walletProvider)throw new Error("WalletConnect is not connected. Connect your Testnet wallet first.");return walletProvider}
async function authRequest(action:"nonce"|"verify"|"me"|"logout",init?:RequestInit){return fetch(`${AUTH_API}?action=${action}`,{credentials:"include",...init})}
export async function connectWalletAndSignIn(){
  const {provider,address:wallet}=await connectWallet();
  const challengeResponse=await authRequest("nonce",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet})}); const challenge=await challengeResponse.json(); if(!challengeResponse.ok)throw new Error(challenge?.error||"Unable to start Testnet wallet sign-in");
  const signature=await provider.request({method:"personal_sign",params:[challenge.message,wallet]});
  const verifyResponse=await authRequest("verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:challenge.session_id,wallet,signature})}); const verified=await verifyResponse.json(); if(!verifyResponse.ok)throw new Error(verified?.error||"Testnet wallet signature verification failed"); return verified.user as AuthUser;
}
export async function getCurrentUser(){const response=await authRequest("me");if(!response.ok)return null;const data=(await response.json()) as {authenticated:boolean;user?:AuthUser};return data.authenticated?data.user||null:null}
export async function signOut(){await authRequest("logout",{method:"POST"});await disconnectWalletConnectSession(walletProvider)}
export async function resetWalletConnectSession(){await disconnectWalletConnectSession(walletProvider);return createTestnetProvider(true)}
