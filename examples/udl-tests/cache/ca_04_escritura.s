#
# UdL · Cache 04 — Escrituras (write-allocate + write-back)
# Un store a bloque ausente: write-allocate lo trae y marca la linea SUCIA (dirty).
# Al expulsarse una linea sucia se produce un Write-back. Mira el contador Write-backs
# y el distintivo "D" (dirty) en la rejilla de contenido.
#
.data
    arr: .word 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15
.text
main:
    la   t0, arr
    li   t1, 0
    li   t2, 16
loop:
    beq  t1, t2, fin
    sw   t1, 0(t0)           # store -> write-allocate + dirty (write-back)
    addi t0, t0, 4
    addi t1, t1, 1
    j    loop
fin:
    li   a7, 10
    ecall
