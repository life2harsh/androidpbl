#!/usr/bin/env bash
set -euo pipefail
R=${AWS_REGION:-ap-southeast-2}
A=$(aws sts get-caller-identity --query Account --output text)
B=rover-patrol-${A}
P="arn:aws:iot:${R}:${A}"
ROLE=arn:aws:iam::${A}:role/rover-iot-rules
CSR=${1:?usage: setup.sh rover.csr [budget-email]}

aws iot create-thing --thing-name rover
CERT=$(aws iot create-certificate-from-csr --set-as-active --certificate-signing-request "file://${CSR}" --query certificateArn --output text)
aws iot describe-certificate --certificate-id "${CERT##*/}" --query certificateDescription.certificatePem --output text > cert.pem
aws iot create-policy --policy-name rover-policy --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
 {\"Effect\":\"Allow\",\"Action\":\"iot:Connect\",\"Resource\":\"${P}:client/rover\"},
 {\"Effect\":\"Allow\",\"Action\":[\"iot:Publish\",\"iot:Receive\"],\"Resource\":[\"${P}:topic/rover/*\",\"${P}:topic/\$aws/things/rover/shadow/*\"]},
 {\"Effect\":\"Allow\",\"Action\":\"iot:Subscribe\",\"Resource\":[\"${P}:topicfilter/rover/*\",\"${P}:topicfilter/\$aws/things/rover/shadow/*\"]}]}"
aws iot attach-policy --policy-name rover-policy --target "${CERT}"
aws iot attach-thing-principal --thing-name rover --principal "${CERT}"

aws s3api create-bucket --bucket "${B}" --create-bucket-configuration LocationConstraint="${R}"
aws s3api put-public-access-block --bucket "${B}" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws dynamodb create-table --table-name rover-verdicts --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=pid,AttributeType=S AttributeName=cp,AttributeType=N \
  --key-schema AttributeName=pid,KeyType=HASH AttributeName=cp,KeyType=RANGE
aws dynamodb create-table --table-name rover-telemetry --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=device,AttributeType=S AttributeName=ts,AttributeType=N \
  --key-schema AttributeName=device,KeyType=HASH AttributeName=ts,KeyType=RANGE
aws dynamodb wait table-exists --table-name rover-telemetry
aws dynamodb update-time-to-live --table-name rover-telemetry --time-to-live-specification Enabled=true,AttributeName=expires

aws iam create-role --role-name rover-iot-rules --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"iot.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam put-role-policy --role-name rover-iot-rules --policy-name write --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
 {\"Effect\":\"Allow\",\"Action\":\"s3:PutObject\",\"Resource\":\"arn:aws:s3:::${B}/*\"},
 {\"Effect\":\"Allow\",\"Action\":\"dynamodb:PutItem\",\"Resource\":[\"arn:aws:dynamodb:${R}:${A}:table/rover-verdicts\",\"arn:aws:dynamodb:${R}:${A}:table/rover-telemetry\"]}]}"
sleep 10

rule() {
  aws iot create-topic-rule --rule-name "$1" --topic-rule-payload \
    "{\"sql\":\"$2\",\"awsIotSqlVersion\":\"2016-03-23\",\"ruleDisabled\":false,\"actions\":[$3]}"
}
rule verdicts_to_dynamodb "SELECT * FROM 'rover/verdict'" \
  "{\"dynamoDBv2\":{\"roleArn\":\"${ROLE}\",\"putItem\":{\"tableName\":\"rover-verdicts\"}}}"
rule telemetry_to_dynamodb "SELECT 'rover' AS device, *, floor(timestamp() / 1000) + 604800 AS expires FROM 'rover/telemetry'" \
  "{\"dynamoDBv2\":{\"roleArn\":\"${ROLE}\",\"putItem\":{\"tableName\":\"rover-telemetry\"}}}"
rule images_to_s3 "SELECT * FROM 'rover/img/+/+'" \
  "{\"s3\":{\"roleArn\":\"${ROLE}\",\"bucketName\":\"${B}\",\"key\":\"\${topic(3)}/cp\${topic(4)}.jpg\"}}"

if [ -n "${2:-}" ]; then
  aws budgets create-budget --account-id "${A}" \
    --budget '{"BudgetName":"rover-1usd","BudgetLimit":{"Amount":"1","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
    --notifications-with-subscribers "[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":50,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$2\"}]},
      {\"Notification\":{\"NotificationType\":\"FORECASTED\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":100,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$2\"}]}]"
fi
echo "AWS_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --output text)"
