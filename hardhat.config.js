require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

function getPrivateKey() {
  const raw = (process.env.PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  defaultNetwork: "sepolia",
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    // Ethereum Sepolia — primary deployment target
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: getPrivateKey() ? [getPrivateKey()] : [],
      chainId: 11155111
    }
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "placeholder",
    },
  },
};
