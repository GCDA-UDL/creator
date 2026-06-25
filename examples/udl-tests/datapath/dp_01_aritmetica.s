#
# UdL · Datapath 01 — Aritmetica (formatos I y R)
# Step y observa: la etapa EX se ilumina; mira rs1/rs2/imm y el resultado de la ALU.
#
.text
main:
    addi t0, x0, 10        # [I] t0 = 10   (imm=10, rs1=x0)
    addi t1, x0, 12        # [I] t1 = 12
    add  t2, t0, t1        # [R] t2 = 22   (ALU = rs1 + rs2)
    sub  t3, t1, t0        # [R] t3 = 2    (12 - 10)
    li   a7, 10
    ecall
