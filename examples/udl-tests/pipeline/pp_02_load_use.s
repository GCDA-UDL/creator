#
# UdL · Pipeline 02 — Load-use: 1 burbuja INEVITABLE aunque haya forwarding
# El dato del load llega en MEM; el uso inmediato en EX no llega a tiempo -> 1 stall RAW.
#
.data
    v: .word 42
.text
main:
    la   t0, v
    lw   t1, 0(t0)         # LOAD
    addi t2, t1, 1         # usa t1 justo despues -> celda azul "RAW" (load-use)
    li   a7, 10
    ecall
