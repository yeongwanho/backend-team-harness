package com.example.orders;

public final class OrderService {
    public String status(String orderId) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("orderId is required");
        }
        return "READY";
    }
}

