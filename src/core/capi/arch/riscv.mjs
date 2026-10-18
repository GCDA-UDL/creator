/**
 * Copyright 2018-2026 CREATOR Team.
 *
 * This file is part of CREATOR.
 *
 * CREATOR is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * CREATOR is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with CREATOR.  If not, see <http://www.gnu.org/licenses/>.
 */

import { bi_BigIntTofloat, bi_BigIntTodouble } from "@/core/utils/bigint.mjs";
import { architecture } from "../../core.mjs";

/**
 * Expansion policy of the `li rd, imm` pseudo-instruction (architecture YAML
 * `config.li_expansion`):
 *  - "standard" (default): the sequence produced by the RISC-V toolchains and by
 *    Ripes — LLVM `RISCVMatInt::generateInstSeq` / GNU as `load_const`: `addi` alone
 *    when the value fits in 12 signed bits, `lui` alone when its low 12 bits are
 *    zero, otherwise `lui` + `addi` (with the +0x800 rounding of the upper part).
 *    The RISC-V Assembly Programmer's Manual only says `li` expands to "myriad
 *    sequences" chosen by the compiler; this is the one every mainstream tool emits.
 *  - "lui_addi": always `lui` + `addi` once the value does not fit in 12 bits, even
 *    when the low part is zero (RARS' template and CREATOR's historical behaviour —
 *    shows both halves to students, at the cost of one extra instruction).
 */
export const LI_EXPANSION_MODES = ["standard", "lui_addi"];
export const DEFAULT_LI_EXPANSION = "standard";

/** `li` policy of the loaded architecture (falls back to the standard one). */
export function liExpansionMode() {
    const m = architecture?.config?.li_expansion;
    return LI_EXPANSION_MODES.includes(m) ? m : DEFAULT_LI_EXPANSION;
}

function isInt(val, bits) {
    const max = (1n << BigInt(bits - 1)) - 1n;
    const min = -(1n << BigInt(bits - 1));
    return BigInt(val) >= min && BigInt(val) <= max;
}

function signExtend(val, bits) {
    const mask = (1n << BigInt(bits)) - 1n;
    const signBit = 1n << (BigInt(bits) - 1n);
    const value = BigInt(val) & mask;
    return value & signBit ? value | ~mask : value;
}

function countTrailingZeros(val) {
    if (val === 0n) return 64;

    let count = 0;
    let value = BigInt(val);
    while ((value & 1n) === 0n) {
        count++;
        value >>= 1n;
    }
    return count;
}

function generateInstructionsImpl(value, instructions, destReg, xlen = 64, mode = DEFAULT_LI_EXPANSION) {
    // Handle 32-bit values with LUI+ADDI sequence
    if (isInt(value, 32)) {
        const hi20 = Number(((value + 0x800n) >> 12n) & 0xfffffn);
        const lo12 = Number(signExtend(value, 12));

        if (hi20) {
            instructions.push(`lui ${destReg}, 0x${hi20.toString(16)}`);
        }

        // standard (LLVM / GNU as / Ripes): the add is skipped when the low 12 bits
        // are zero; "lui_addi" always emits it after a lui (both halves visible).
        if (lo12 || hi20 === 0 || mode === "lui_addi") {
            // RV64 needs addiw after a lui (the result is sign-extended from 32 bits);
            // RV32 only has addi.
            const op = hi20 && xlen === 64 ? "addiw" : "addi";
            const src = hi20 ? destReg : "x0";
            instructions.push(`${op} ${destReg}, ${src}, ${lo12}`);
        }
        return;
    }

    // Handle larger values (RV64)
    const lo12 = Number(signExtend(value, 12));
    let remainingValue = value - BigInt(lo12);

    // Check if shifting can simplify the representation
    let shift = 0;
    if (!isInt(remainingValue, 32)) {
        shift = countTrailingZeros(remainingValue);

        // Handle case where shift would be 64 or greater (invalid for RISC-V slli)
        if (shift >= 64) {
            // If shift is 64+, remainingValue shifted right by 64+ bits is 0 in 64-bit arithmetic
            // So we only need to handle the lo12 part directly
            if (lo12) {
                instructions.push(`addi ${destReg}, x0, ${lo12}`);
            } else {
                instructions.push(`addi ${destReg}, x0, 0`); // Zero out register
            }
            return; // Exit early as we've handled the value directly
        }

        remainingValue >>= BigInt(shift);
    }

    // Process the remaining value recursively
    generateInstructionsImpl(remainingValue, instructions, destReg, xlen, mode);

    // Apply shift if needed
    if (shift) {
        instructions.push(`slli ${destReg}, ${destReg}, ${shift}`);
    }

    // Add lower 12 bits if needed
    if (lo12) {
        instructions.push(`addi ${destReg}, ${destReg}, ${lo12}`);
    }
}

export const ARCH = {
    /** RV64 `li`: 64-bit value → shortest lui/addi(w)/slli sequence (policy: config.li_expansion). */
    generateLoadImmediate(val, destReg, mode) {
        const instructions = [];
        generateInstructionsImpl(BigInt(val), instructions, destReg, 64, mode ?? liExpansionMode());
        return instructions.join(";");
    },
    /** RV32 `li`: the operand is a 32-bit pattern (may arrive unsigned, e.g. 0xF00010A8) → addi | lui | lui+addi. */
    generateLoadImmediate32(val, destReg, mode) {
        const instructions = [];
        generateInstructionsImpl(signExtend(BigInt(val), 32), instructions, destReg, 32, mode ?? liExpansionMode());
        return instructions.join(";");
    },
    toJSNumberD(bigIntValue) {
        //  Used when the D extension is enabled
        //  These are the possible cases:
        //  1. The value is a float64 NaN
        //      1.1 The value is a NaN-boxed float32 (upper 32
        //          bits are all 1's, lower 32 bits contain
        //          float32 representation).
        //      1.2 The value is the canonical NaN (0x7ff8000000000000n)
        //  2. The value is a valid float64 representation

        //  See RISC-V Spec, section 21.2

        bigIntValue = BigInt(bigIntValue);
        const bitString = bigIntValue.toString(2);
        const is64Bit = bitString.length <= 64;
        const lowerBits = bigIntValue & 0xffffffffn;
        const canonicalNaN64 = 0x7ff8000000000000n;
        const isCanonicalNaN64 = bigIntValue === canonicalNaN64;
        const upperBits = bigIntValue >> 32n;
        const isNaNBoxed32 = upperBits === 0xffffffffn;
        // Special check for 0
        if (bigIntValue === 0n) {
            return [0, "float32"];
        }
        if (!is64Bit) {
            throw new Error(
                "Called toJSNumberD with a value greater than 64 bits",
            );
        }
        if (isCanonicalNaN64) {
            return [NaN, "NaN64"];
        } else if (isNaNBoxed32) {
            return [bi_BigIntTofloat(lowerBits), "NaNBfloat32_64"];
        } else {
            return [bi_BigIntTodouble(bigIntValue), "float64"];
        }
    },
    toJSNumberS(bigIntValue) {
        //  Used when ONLY the S extension is enabled
        bigIntValue = BigInt(bigIntValue);
        const bitString = bigIntValue.toString(2);
        const is32Bit = bitString.length <= 32;
        const canonicalNaN32 = 0x7fc00000n;
        const isCanonicalNaN32 = bigIntValue === canonicalNaN32;
        if (isCanonicalNaN32) {
            return [NaN, "NaN32"];
        }
        // Special check for 0
        if (bigIntValue === 0n) {
            return [0, "float32"];
        }
        if (!is32Bit) {
            throw new Error(
                "Called toJSNumberS with a value greater than 32 bits",
            );
        }
        return [bi_BigIntTofloat(bigIntValue), "float32"];
    },
    toBigInt(number, type) {
        number = Number(number);

        switch (type) {
            case "float32": {
                // Convert to float32 representation
                const buffer = new ArrayBuffer(4);
                const float32Arr = new Float32Array(buffer);
                const uint32Array = new Uint32Array(buffer);

                float32Arr[0] = number;
                return BigInt(uint32Array[0]);
            }
            case "float64": {
                // Convert to float64 representation
                const buffer = new ArrayBuffer(8);
                const float64Arr = new Float64Array(buffer);
                const uint32Array = new Uint32Array(buffer);

                float64Arr[0] = number;

                // Combine the two 32-bit parts into a 64-bit BigInt
                const lowerBits = BigInt(uint32Array[0]);
                const upperBits = BigInt(uint32Array[1]);
                return (upperBits << 32n) | lowerBits;
            }
            case "NaNBfloat32_64": {
                // Convert to NaN-boxed float32
                const buffer = new ArrayBuffer(4);
                const float32Arr = new Float32Array(buffer);
                const uint32Array = new Uint32Array(buffer);

                float32Arr[0] = number;
                const integerValue = uint32Array[0];

                // Create NaN-boxed representation: upper 32 bits all 1's
                const upperBits = 0xffffffffn;
                const lowerBits = BigInt(integerValue);

                return (upperBits << 32n) | lowerBits;
            }
            case "NaN64":
                return 0x7ff8000000000000n;
            case "NaN32":
                return 0x7fc00000n;
            default:
                throw new Error("Unknown type for toBigInt: " + type);
        }
    },
    NaNBox(bigIntValue) {
        //  Used when the D extension is enabled
        //  Simply NaN-boxes the value
        //  See RISC-V Spec, section 21.2
        bigIntValue = BigInt(bigIntValue);
        const bitString = bigIntValue.toString(16).padStart(8, "0");
        let NaNBoxed = "0xFFFFFFFF" + bitString;
        if (NaNBoxed.length > 18) {
            throw new Error("NaNBoxed value exceeds 64 bits: " + NaNBoxed);
        }
        // Back to bigint
        NaNBoxed = BigInt(NaNBoxed);
        return NaNBoxed;
    },
    /**
     * Writes a float32 to a register, using NaN boxing with float64
     * @param {number} value - The JavaScript number to write
     * @param {string} regName - The base register name (must be even, e.g., "f0")
     **/
    writeFloat(value, regName) {
        const bits = this.toBigInt(value, "NaNBfloat32_64")
        CAPI.REG.write(bits, regName)
    }
};
