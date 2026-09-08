# FlowPay

Streaming payments (money-per-second) on **BOT Chain**. Open a stream to any address, and BOT flows to them continuously — they can withdraw whatever has accrued at any moment; you can cancel at any time and get back what hasn't streamed yet.

## Networks

| Network | ChainId | RPC                       | Explorer                 |
|---------|---------|---------------------------|--------------------------|
| Testnet | 968     | https://rpc.bohr.life     | https://scan.bohr.life   |
| Mainnet | 677     | https://rpc.botchain.ai   | https://scan.botchain.ai |

Native token: **BOT** (18 decimals).

## Quickstart

```bash
npm install
cp .env.example .env      # fill in PRIVATE_KEY
npx hardhat compile
npx hardhat test
npm run deploy:testnet    # or deploy:mainnet
```

After deploying, paste the address into `frontend/index.html` (`CONTRACT_ADDRESS` constant).

Serve the frontend locally:

```bash
cd frontend && python3 -m http.server 8000
```

Or deploy the `frontend/` directory to Vercel — `vercel.json` is set up.

## Opening a stream

1. Connect MetaMask (BOT Chain Testnet is added on demand).
2. Enter recipient address, amount in BOT, and pick a duration.
3. Sign the transaction — the total amount is escrowed in the contract.
4. From the moment the tx is mined, `ratePerSec = totalAmount / durationSecs` (post-fee) accrues to the recipient.

## Streaming math

- `platformFeeBps` is deducted up front (default 50 bps = 0.5%, hard cap 10%).
- `ratePerSec = (msg.value - fee) / durationSecs` — integer division; any dust goes to `accumulatedFees`.
- `withdrawableAmount = min(elapsed * ratePerSec, totalAmount) - withdrawn`.
- On `cancel`, recipient is paid the accrued-but-unwithdrawn amount and sender is refunded the rest.

## Contract surface

- `openStream(recipient, durationSecs) payable returns (streamId)`
- `withdraw(streamId)` — recipient only
- `cancel(streamId)` — sender only
- `withdrawableAmount(streamId) view`
- `getStream(streamId) view`
- `getStreamsBySender(addr) / getStreamsByRecipient(addr) view`
- Admin: `pause()`, `unpause()`, `setPlatformFeeBps(bps)`, `withdrawFees(to)`

## License

MIT.
