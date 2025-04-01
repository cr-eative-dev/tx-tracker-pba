import type {
    API,
    FinalizedEvent,
    IncomingEvent,
    NewBlockEvent,
    NewTransactionEvent,
    OutputAPI,
} from "../types"

export default function creativedev(api: API, outputApi: OutputAPI) {
    // Requirements:
    //
    // 1) When a transaction becomes "settled"-which always occurs upon receiving a "newBlock" event-
    //    you must call `outputApi.onTxSettled`.
    //
    //    - Multiple transactions may settle in the same block, so `onTxSettled` could be called
    //      multiple times per "newBlock" event.
    //    - Ensure callbacks are invoked in the same order as the transactions originally arrived.
    //
    // 2) When a transaction becomes "done"-meaning the block it was settled in gets finalized-
    //    you must call `outputApi.onTxDone`.
    //
    //    - Multiple transactions may complete upon a single "finalized" event.
    //    - As above, maintain the original arrival order when invoking `onTxDone`.
    //    - Keep in mind that the "finalized" event is not emitted for all finalized blocks.
    //
    // Notes:
    // - It is **not** ok to make redundant calls to either `onTxSettled` or `onTxDone`.
    // - It is ok to make redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`
    //
    // Bonus 1:
    // - Avoid making redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`.
    //
    // Bonus 2:
    // - Upon receiving a "finalized" event, call `api.unpin` to unpin blocks that are either:
    //     a) pruned, or
    //     b) older than the currently finalized block.

    const pendingTxs = new Set<string>();
    const settledTxs = new Map<string, string>();
    const doneTxs = new Set<string>();
    const newTxs: string[] = [];
    const blockParents = new Map<string, string>();

    const onNewBlock = ({ blockHash, parent }: NewBlockEvent) => {
        console.log("new block:", blockHash, parent);
        blockParents.set(blockHash, parent);

        const txsInBlock = api.getBody(blockHash);

        for (const txHash of txsInBlock) {
            if (settledTxs.has(txHash) || doneTxs.has(txHash)) continue;
            const isValid = api.isTxValid(blockHash, txHash);

            if (!pendingTxs.has(txHash)) {
                newTxs.push(txHash);
            }

            settledTxs.set(txHash, blockHash);
            pendingTxs.delete(txHash);

            if (isValid) {
                outputApi.onTxSettled(txHash, {
                    blockHash,
                    type: "valid",
                    successful: api.isTxSuccessful(blockHash, txHash),
                });
            } else {
                outputApi.onTxSettled(txHash, {
                    blockHash,
                    type: "invalid",
                });
            }
        }
    }

    const onNewTx = ({ value: transaction }: NewTransactionEvent) => {
        console.log("new tx:", transaction);
        if (!pendingTxs.has(transaction) && !settledTxs.has(transaction) && !doneTxs.has(transaction)) {
            pendingTxs.add(transaction);
            newTxs.push(transaction);
        }
    }

    const onFinalized = ({ blockHash }: FinalizedEvent) => {
        console.log("finalized;", blockHash);
        const finalizedBlocks = new Set<string>();
        let current = blockHash;

        while (current) {
            finalizedBlocks.add(current);
            current = blockParents.get(current) || '';
        }

        const txsToDone = new Set<string>();
        for (const [txHash, txBlockHash] of settledTxs.entries()) {
            if (finalizedBlocks.has(txBlockHash)) {
                txsToDone.add(txHash);
            }
        }

        for (const txHash of newTxs) {
            if (txsToDone.has(txHash)) {
                const blockHash = settledTxs.get(txHash) || '';
                const isValid = api.isTxValid(blockHash, txHash);

                if (isValid) {
                    outputApi.onTxDone(txHash, {
                        blockHash,
                        type: "valid",
                        successful: api.isTxSuccessful(blockHash, txHash),
                    });
                } else {
                    outputApi.onTxDone(txHash, {
                        blockHash,
                        type: "invalid",
                    });
                }

                settledTxs.delete(txHash);
                doneTxs.add(txHash);
            }
        }
    }

    return (event: IncomingEvent) => {
        switch (event.type) {
            case "newBlock": {
                onNewBlock(event)
                break
            }
            case "newTransaction": {
                onNewTx(event)
                break
            }
            case "finalized":
                onFinalized(event)
        }
    }
}

