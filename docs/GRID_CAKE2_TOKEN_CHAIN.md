# Grid CAKE2 Token Chain

## Purpose

The first-party Grid Agent proof on BSC Testnet must never fund, authorize, preflight, or execute a different token than the token it declares for execution.

## Canonical Grid proof token

- Network: BSC Testnet
- Chain ID: 97
- Token symbol: CAKE2
- Token address: `0x8d008B313C1d6C7fE2982F62d32Da7507cF43551`
- Output token: WBNB `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`

## Required flow

1. Grid's execution capability declares the exact `token_in` address.
2. AgentMarket's execution-capital request stores that exact address as `capital_token`.
3. The Altana grant UI requires `capitalToken`; it no longer falls back to the settlement U token.
4. The user-funded ERC-20 transfer uses the exact stored `capital_token`.
5. Router allowance approval uses the same token address and exact requested raw amount.
6. Grid's Testnet executor rejects any `token_in` other than the canonical CAKE2 address.
7. Grid preflight must report the same token address that was sent to it.
8. The encoded PancakeSwap call must therefore carry the exact CAKE2 address.

## Trust rule

For the Grid proof, an address mismatch is a hard failure. The system must not silently replace the requested token with a configured default, settlement token, or another asset.

This is a test-agent-specific invariant. It does not make AgentMarket Grid-specific: external agents may declare different execution tokens, while the marketplace always funds exactly the token declared and recorded for that request.

## Altana gas permission

The Grid execution session also carries the native BNB gas-recovery spend permission in addition to the ERC-20 execution-token permission. Both permissions must be reconstructed when Grid executes through Altana.
