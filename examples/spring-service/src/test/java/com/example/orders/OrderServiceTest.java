package com.example.orders;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class OrderServiceTest {
    private final OrderService service = new OrderService();

    @Test
    void returnsReadyForAValidOrder() {
        assertEquals("READY", service.status("ORDER-1"));
    }

    @Test
    void rejectsAnEmptyOrderId() {
        assertThrows(IllegalArgumentException.class, () -> service.status(" "));
    }
}
