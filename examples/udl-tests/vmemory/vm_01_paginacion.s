#
# UdL · Virtual mem 01 — Paginacion (8 paginas nuevas)
# Config def. (pagina 256 B, RAM 8 marcos): esperado 8 TLB miss + 8 PAGE FAULTS.
#
.data
    big: .zero 2048              # 8 paginas de 256 B
.text
main:
    la   t0, big
    li   t1, 0
    li   t2, 8
loop:
    beq  t1, t2, fin
    lw   t3, 0(t0)              # pagina nueva -> TLB miss + fallo de pagina
    addi t0, t0, 256            # siguiente pagina
    addi t1, t1, 1
    j    loop
fin:
    li   a7, 10
    ecall
