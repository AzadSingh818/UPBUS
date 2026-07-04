const { EC2Client, DescribeInstancesCommand, RebootInstancesCommand } = require("@aws-sdk/client-ec2");

const accessKeyId = "AKIATATTA6L5GZZQOVE2";
const secretAccessKey = "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";
const publicIp = "13.61.187.15";

async function rebootInstance() {
  const regions = ["ap-south-1", "ap-south-2", "eu-north-1", "us-east-1"];
  let instanceId = null;
  let activeRegion = null;

  for (const region of regions) {
    const client = new EC2Client({
      region,
      credentials: { accessKeyId, secretAccessKey }
    });

    try {
      const command = new DescribeInstancesCommand({
        Filters: [{ Name: "ip-address", Values: [publicIp] }]
      });
      const response = await client.send(command);

      if (response.Reservations && response.Reservations.length > 0) {
        instanceId = response.Reservations[0].Instances[0].InstanceId;
        activeRegion = region;
        console.log(`Found instance ${instanceId} in region ${region}. Rebooting now...`);
        
        const rebootCmd = new RebootInstancesCommand({ InstanceIds: [instanceId] });
        await client.send(rebootCmd);
        console.log("Successfully sent reboot command to AWS!");
        return;
      }
    } catch (err) {
      console.log(`Region ${region} failed or not found.`);
    }
  }

  if (!instanceId) {
    console.log("Could not find any instance with the given IP address across checked regions.");
  }
}

rebootInstance();
