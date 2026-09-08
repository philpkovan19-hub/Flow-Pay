const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);

  console.log("Deploying FlowPay...");
  console.log("Signer:  ", signer.address);
  console.log("Balance: ", ethers.formatEther(balance), "BOT");

  const F = await ethers.getContractFactory("FlowPay");
  const flowpay = await F.deploy();
  await flowpay.waitForDeployment();
  const addr = await flowpay.getAddress();

  console.log("FlowPay deployed to:", addr);
  console.log("");
  console.log("Update CONTRACT_ADDRESS in frontend/index.html with this address.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
