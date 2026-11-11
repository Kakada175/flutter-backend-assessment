// ============================================================================
// Assessment Submission: Tonaire Digital Co., Ltd.
// Candidate: Chhem Kakada
// File: flutter/product_model.dart
// Description: Demonstrates Dart null-safety crash on renamed field vs. resilient parsing
// ============================================================================

import 'dart:convert';

/// 1. VULNERABLE OLD FLUTTER MODEL (Deployed in older mobile app versions)
/// Notice: Relies strictly on `json['price']` being non-null.
class LegacyProduct {
  final int id;
  final String name;
  final double price;

  LegacyProduct({
    required this.id,
    required this.name,
    required this.price,
  });

  factory LegacyProduct.fromJson(Map<String, dynamic> json) {
    return LegacyProduct(
      id: json['id'] as int,
      name: json['name'] as String,
      // CRITICAL FAILURE POINT:
      // If the backend returns `{"unitPrice": 29.99}` instead of `{"price": 29.99}`,
      // `json['price']` evaluates to `null`.
      // In Dart sound null safety, `(null as num)` throws:
      // "type 'Null' is not a subtype of type 'num' in type cast"
      price: (json['price'] as num).toDouble(),
    );
  }
}

/// 2. RESILIENT MODERN FLUTTER MODEL (Best practice for mobile clients)
/// - Checks 'price' first (legacy contract), fallback to 'unitPrice'.
/// - Uses `rawPrice is! num` check to validate both int and double without unsafe `as double` cast.
/// - Throws FormatException on missing/invalid price instead of silently masking with zero.
class ResilientProduct {
  final int id;
  final String name;
  final double price;
  final String currency;

  ResilientProduct({
    required this.id,
    required this.name,
    required this.price,
    this.currency = 'USD',
  });

  factory ResilientProduct.fromJson(Map<String, dynamic> json) {
    // 1. Validate Product ID
    final rawId = json['id'];
    final int parsedId;
    if (rawId is int) {
      parsedId = rawId;
    } else if (rawId is String) {
      parsedId = int.tryParse(rawId) ?? (throw FormatException('Invalid product id: $rawId'));
    } else {
      throw FormatException('Missing or invalid product id');
    }

    // 2. Backward-Compatible Price Parsing (num check handles both int 29 and double 29.99)
    final rawPrice = json['price'] ?? json['unitPrice'];
    if (rawPrice is! num) {
      throw FormatException('Missing or invalid product price in response: $json');
    }
    final double parsedPrice = rawPrice.toDouble();

    // 3. Name & Currency
    final name = json['name']?.toString() ?? (throw FormatException('Missing product name'));
    final currency = json['currency']?.toString() ?? 'USD';

    return ResilientProduct(
      id: parsedId,
      name: name,
      price: parsedPrice,
      currency: currency,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'price': price,
    'currency': currency,
  };
}

void main() {
  print('=== Demonstration of Backward Compatibility Break ===\n');

  // Payload returned after unintended breaking backend change:
  const breakingJsonString = '{"id": 101, "name": "Classic T-Shirt", "unitPrice": 29.99}';
  final Map<String, dynamic> breakingData = jsonDecode(breakingJsonString);

  print('1. Simulating Old Flutter App receiving payload with "unitPrice" only:');
  try {
    final legacyProduct = LegacyProduct.fromJson(breakingData);
    print('Parsed: ${legacyProduct.name} at \$${legacyProduct.price}');
  } catch (e) {
    print('CRASH DETECTED on legacy client: $e');
    print('Result: The mobile app crashes or displays a blank/error screen to end users.\n');
  }

  print('2. Simulating Resilient Flutter App receiving breaking payload:');
  try {
    final modernProduct = ResilientProduct.fromJson(breakingData);
    print('SUCCESS: Parsed ${modernProduct.name} at \$${modernProduct.price} ${modernProduct.currency}\n');
  } catch (e) {
    print('Unexpected error: $e');
  }

  print('3. Simulating Resilient Flutter App receiving integer price (e.g. 29):');
  final Map<String, dynamic> intPriceData = {'id': 102, 'name': 'Hat', 'price': 29};
  try {
    final intPriceProduct = ResilientProduct.fromJson(intPriceData);
    print('SUCCESS: Parsed ${intPriceProduct.name} with integer price at \$${intPriceProduct.price} ${intPriceProduct.currency}\n');
  } catch (e) {
    print('Failed on integer price: $e');
  }

  print('4. Simulating Resilient Flutter App detecting truly missing price:');
  final Map<String, dynamic> missingPriceData = {'id': 103, 'name': 'Mystery Item'};
  try {
    ResilientProduct.fromJson(missingPriceData);
  } catch (e) {
    print('SUCCESS: Correctly rejected missing price with exception: $e');
  }
}
