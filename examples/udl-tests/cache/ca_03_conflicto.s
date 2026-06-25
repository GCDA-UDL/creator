#
# UdL · Cache 03 — Fallos de CONFLICTO (bloques al mismo conjunto)
# offsets 0,64,128 -> bloques 0,4,8 -> indice = bloque mod 4 = 0 (config def. 4 conjuntos).
# Con 2 vias, el 3er bloque expulsa al LRU -> fallos de CONFLICTO repetidos.
#
.data
    arr: .word 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35
.text
main:
    la   t0, arr
    li   t1, 0
    li   t2, 4
loop:
    beq  t1, t2, fin
    lw   a0, 0(t0)           # bloque 0 (set 0)
    lw   a0, 64(t0)          # bloque 4 (set 0)
    lw   a0, 128(t0)         # bloque 8 (set 0) -> expulsion LRU -> CONFLICT
    addi t1, t1, 1
    j    loop
fin:
    li   a7, 10
    ecall
