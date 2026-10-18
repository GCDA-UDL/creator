# Datapath 08 · Pseudo-instrucción li: cómo se expande (addi | lui | lui+addi)
#
# `li rd, imm` NO es una instrucción RISC-V: el ensamblador la expande según el valor
# (config.li_expansion = "standard", la secuencia de las toolchains RISC-V y de Ripes):
#   - cabe en 12 bits con signo  -> addi rd, x0, imm                 (1 instrucción, formato I)
#   - 12 bits bajos a cero       -> lui  rd, imm[31:12]              (1 instrucción, formato U)
#   - resto                      -> lui + addi (parte alta redondeada si el bit 11 es 1)
# Con config.li_expansion = "lui_addi" (estilo RARS) los dos últimos casos emiten siempre lui+addi.
# Compara la columna "Loaded Instructions" con "User Instruction" en la tabla de código.
.text
main:
    li   t0, 5              # -> addi t0, x0, 5
    li   t1, 0x12345000     # -> lui t1, 0x12345          (parte baja 0: sin addi)
    li   t2, 0x12345678     # -> lui t2, 0x12345 ; addi t2, t2, 0x678
    li   t3, -1             # -> addi t3, x0, -1
    li   t4, 0x7FFFF800     # -> lui t4, 0x80000 ; addi t4, t4, -2048   (redondeo de la parte alta)
    li   t5, 0xFF0000       # -> lui t5, 0xff0            (el mismo caso que lab_11_rgb)
    add  t6, t1, t2
    li   a7, 10
    ecall
