require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

function getPrivateKey() {
  const raw = (process.env.PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  defaultNetwork: "amoy",
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    // Polygon Amoy — primary deployment target (Polygon ID ecosystem)
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: getPrivateKey() ? [getPrivateKey()] : [],
      chainId: 80002,
      gasPrice: "auto",
    },
    // Ethereum Sepolia — kept for reference / legacy
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: getPrivateKey() ? [getPrivateKey()] : [],
      chainId: 11155111
    }
  },
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "placeholder",
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
};
