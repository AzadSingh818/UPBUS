const { EC2Client, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");

const accessKeyId = "AKIATATTA6L5GZZQOVE2";
const secretAccessKey = "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";
const instanceId = "i-013939b695a8ec784";
const region = "eu-north-1";

async function getIp() {
  const client = new EC2Client({
    region,
    credentials: { accessKeyId, secretAccessKey }
  });

  try {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    });
    const response = await client.send(command);

    if (response.Reservations && response.Reservations.length > 0) {
      const ip = response.Reservations[0].Instances[0].PublicIpAddress;
      console.log(`NEW_IP=${ip}`);
    } else {
      console.log("Instance not found.");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

getIp();
