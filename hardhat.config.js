require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    botchain_testnet: {
      url: "https://rpc.bohr.life",
      chainId: 968,
      accounts: [PRIVATE_KEY],
    },
    botchain: {
      url: "https://rpc.botchain.ai",
      chainId: 677,
      accounts: [PRIVATE_KEY],
    },
  },
};
