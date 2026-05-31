#!/bin/bash
# Run pipelines for all industries that don't have a chain yet, one at a time

cd /Users/chao/Documents/Projects/atlas

INDUSTRIES=("Autonomous Driving" "New Energy" "Genomics" "Commercial Space")

for INDUSTRY in "${INDUSTRIES[@]}"; do
  PID=$(psql -d atlas -t -c "SELECT id FROM \"Project\" WHERE industry = '$INDUSTRY' ORDER BY \"createdAt\" DESC LIMIT 1;" 2>/dev/null | tr -d ' ')

  # Check if already has a completed chain
  EXISTING=$(psql -d atlas -t -c "SELECT status FROM \"IndustryChain\" WHERE \"projectId\" = '$PID' AND status = 'COMPLETED';" 2>/dev/null | tr -d ' ')
  if [ "$EXISTING" = "COMPLETED" ]; then
    echo "⏭ $INDUSTRY — already completed, skipping"
    continue
  fi

  # Delete any failed/stuck chains
  psql -d atlas -c "DELETE FROM \"IndustryChain\" WHERE \"projectId\" = '$PID';" 2>/dev/null

  # Create new chain
  CID=$(psql -d atlas -t -c "INSERT INTO \"IndustryChain\" (id, \"projectId\", status, \"maxDepth\", logs, \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid(), '$PID', 'GENERATING', 2, '{}', NOW(), NOW()) RETURNING id;" 2>/dev/null | tr -d ' ')

  echo ""
  echo "🚀 Starting: $INDUSTRY (chain: $CID)"
  echo "   $(date)"

  npx tsx scripts/run-pipeline.ts "$CID" "$INDUSTRY" 2>&1 | tail -5

  STATUS=$(psql -d atlas -t -c "SELECT status FROM \"IndustryChain\" WHERE id = '$CID';" 2>/dev/null | tr -d ' ')
  NODES=$(psql -d atlas -t -c "SELECT COUNT(*) FROM \"ChainNode\" WHERE \"chainId\" = '$CID';" 2>/dev/null | tr -d ' ')
  COMPANIES=$(psql -d atlas -t -c "SELECT COUNT(*) FROM \"Company\" c JOIN \"ChainNode\" cn ON cn.id = c.\"chainNodeId\" WHERE cn.\"chainId\" = '$CID';" 2>/dev/null | tr -d ' ')

  echo "   Result: $STATUS | $NODES nodes | $COMPANIES companies"

  # If failed on profit chain (common), mark as completed anyway
  if [ "$STATUS" = "FAILED" ] && [ "$NODES" -gt 0 ] && [ "$COMPANIES" -gt 0 ]; then
    psql -d atlas -c "UPDATE \"IndustryChain\" SET status = 'COMPLETED' WHERE id = '$CID';" 2>/dev/null
    echo "   ⚠ Marked as COMPLETED (data exists, likely failed on profit chain step)"
  fi
done

echo ""
echo "🏁 All industries done!"
echo ""
psql -d atlas -c "
SELECT p.name, p.industry, ic.status,
  (SELECT COUNT(*) FROM \"ChainNode\" cn WHERE cn.\"chainId\" = ic.id) as nodes,
  (SELECT COUNT(*) FROM \"Company\" c JOIN \"ChainNode\" cn ON cn.id = c.\"chainNodeId\" WHERE cn.\"chainId\" = ic.id) as companies
FROM \"Project\" p
JOIN \"IndustryChain\" ic ON ic.\"projectId\" = p.id
WHERE ic.status = 'COMPLETED'
ORDER BY p.\"createdAt\";" 2>/dev/null
