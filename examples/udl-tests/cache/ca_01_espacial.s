#
# UdL · Cache 01 — Localidad ESPACIAL (recorrido secuencial)
# Config def. (bloque = 4 palabras): 1 fallo COMPULSORY por bloque + 3 ACIERTOS.
# Esperado: 16 accesos -> 4 miss + 12 hit (hit rate 75 %).
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
    lw   t3, 0(t0)            # miss al entrar en bloque nuevo, luego HIT x3
    addi t0, t0, 4
    addi t1, t1, 1
    j    loop
fin:
    li   a7, 10
    ecall
