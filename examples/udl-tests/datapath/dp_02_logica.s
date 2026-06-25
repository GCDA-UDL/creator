#
# UdL · Datapath 02 — Logica y desplazamientos (operaciones ALU bit a bit)
#
.text
main:
    addi t0, x0, 10        # 1010b
    addi t1, x0, 12        # 1100b
    and  t2, t0, t1        # t2 = 1000b = 8
    or   t3, t0, t1        # t3 = 1110b = 14
    xor  t4, t0, t1        # t4 = 0110b = 6
    slli t5, t0, 2         # t5 = 10 << 2 = 40
    li   a7, 10
    ecall
