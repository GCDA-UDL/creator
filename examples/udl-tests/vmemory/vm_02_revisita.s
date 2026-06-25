#
# UdL · Virtual mem 02 — Revisita (localidad -> TLB hits)
# Toca 4 paginas y las revisita 3 veces. Tras la 1a vuelta -> TLB HIT (TLB=4 entradas).
#
.data
    big: .zero 1024              # 4 paginas de 256 B
.text
main:
    li   t4, 0
    li   t5, 3                   # 3 vueltas
outer:
    beq  t4, t5, fin
    la   t0, big
    li   t1, 0
    li   t2, 4
inner:
    beq  t1, t2, next
    lw   t3, 0(t0)              # 1a vuelta: miss; siguientes: TLB HIT
    addi t0, t0, 256
    addi t1, t1, 1
    j    inner
next:
    addi t4, t4, 1
    j    outer
fin:
    li   a7, 10
    ecall
