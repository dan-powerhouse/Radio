// Hardened draft reference profile. These are independent of logical ops.
export const MAX_SCAN_INPUT_BYTES = 65_536;
export const MAX_SCAN_SNAPSHOT_BYTES = 524_288;
export const MAX_SCAN_LAWS = 4096;
export const MAX_SCAN_LAW_BYTES = 16_777_216;
export const MAX_EVAL_WORK = 4_194_304;
export const MAX_EVAL_VALUE_BYTES = 65_536;
export const MAX_RESULT_PART_BYTES = 1_048_576;
export const MAX_PUBLIC_RECEIPT_BYTES = 245_760;
export const MAX_EVIDENCE_BYTES = 8_388_608;
export const MAX_EVIDENCE_PAIR_BYTES = MAX_RESULT_PART_BYTES + MAX_PUBLIC_RECEIPT_BYTES + 64;
