#
# UdL · Datapath 03 — Multiplicador (extension M)
# Al ejecutar mul/mulh se ILUMINA la unidad MUL del esquema.
#
.text
main:
    addi t0, x0, 10
    addi t1, x0, 12
    mul  t2, t0, t1        # t2 = 120  (parte baja)
    mulh t3, t0, t1        # t3 = 0    (parte alta del producto de 64 bits)
    li   a7, 10
    ecall
