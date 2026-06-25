#
# UdL · Virtual mem 03 — THRASHING (hiperpaginacion)
# Recorre 8 paginas en bucle (3 vueltas). Con RAM=8 marcos: tras la 1a vuelta, sin fallos.
# Baja "RAM frames" a 3 (preset "Tight RAM"): el conjunto de trabajo (8) NO cabe ->
# expulsiones constantes -> PAGE FAULTS en cada vuelta. Compara LRU vs FIFO.
#
.data
    big: .zero 2048              # 8 paginas de 256 B
.text
main:
    li   t4, 0
    li   t5, 3
outer:
    beq  t4, t5, fin
    la   t0, big
    li   t1, 0
    li   t2, 8
inner:
    beq  t1, t2, next
    lw   t3, 0(t0)
    addi t0, t0, 256
    addi t1, t1, 1
    j    inner
next:
    addi t4, t4, 1
    j    outer
fin:
    li   a7, 10
    ecall
