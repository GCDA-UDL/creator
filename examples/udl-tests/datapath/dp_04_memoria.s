#
# UdL · Datapath 04 — Memoria de datos (load/store, etapa MEM)
#
.data
    arr: .word 7, 11, 0
.text
main:
    la   t0, arr           # direccion base (pseudo: auipc + addi)
    lw   t1, 0(t0)         # [I] t1 = 7    (MEM -> registro)
    lw   t2, 4(t0)         # t2 = 11
    add  t3, t1, t2        # t3 = 18
    sw   t3, 8(t0)         # [S] arr[2] = 18  (registro -> MEM)
    li   a7, 10
    ecall
