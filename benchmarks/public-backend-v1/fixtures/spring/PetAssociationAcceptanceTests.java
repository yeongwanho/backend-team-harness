package org.springframework.samples.petclinic.owner;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.validation.BeanPropertyBindingResult;

import static org.junit.jupiter.api.Assertions.*;

/** Independent behavior checks. Execute real domain/validator code, without a DB. */
class PetAssociationAcceptanceTests {

	private Pet pet(Integer id, String name) {
		Pet pet = new Pet();
		pet.setId(id);
		pet.setName(name);
		PetType type = new PetType();
		type.setName("cat");
		pet.setType(type);
		pet.setBirthDate(LocalDate.of(2020, 1, 2));
		return pet;
	}

	private BeanPropertyBindingResult validate(Pet pet) {
		BeanPropertyBindingResult errors = new BeanPropertyBindingResult(pet, "pet");
		new PetValidator().validate(pet, errors);
		return errors;
	}

	@Test
	void persistedPetCanBeAssociatedWithoutRewritingItsFields() {
		Owner owner = new Owner();
		Pet stored = pet(42, "Stored");
		owner.addPet(stored);
		assertEquals(List.of(stored), owner.getPets());
		assertSame(stored, owner.getPets().get(0));
		assertEquals(42, stored.getId());
		assertEquals("Stored", stored.getName());
		assertEquals(LocalDate.of(2020, 1, 2), stored.getBirthDate());
	}

	@Test
	void addingTheSamePersistedObjectTwiceIsIdempotent() {
		Owner owner = new Owner();
		Pet stored = pet(42, "Stored");
		owner.addPet(stored);
		owner.addPet(stored);
		assertEquals(List.of(stored), owner.getPets());
	}

	@Test
	void anotherObjectWithTheSamePersistedIdDoesNotReplaceOrDuplicateIt() {
		Owner owner = new Owner();
		Pet original = pet(42, "Original");
		owner.addPet(original);
		owner.addPet(pet(42, "Another instance"));
		assertEquals(1, owner.getPets().size());
		assertSame(original, owner.getPets().get(0));
		assertEquals("Original", original.getName());
	}

	@Test
	void differentPersistedIdsRemainSeparateAssociations() {
		Owner owner = new Owner();
		Pet first = pet(42, "First");
		Pet second = pet(43, "Second");
		owner.addPet(first);
		owner.addPet(second);
		assertEquals(List.of(first, second), owner.getPets());
	}

	@Test
	void addingTheSameNewObjectTwiceDoesNotDuplicateIt() {
		Owner owner = new Owner();
		Pet fresh = pet(null, "Fresh");
		owner.addPet(fresh);
		owner.addPet(fresh);
		assertEquals(List.of(fresh), owner.getPets());
	}

	@Test
	void separateNewPetsAreNotDeduplicatedByTheirNullIds() {
		Owner owner = new Owner();
		Pet first = pet(null, "First");
		Pet second = pet(null, "Second");
		Pet stored = pet(42, "Stored");
		owner.addPet(first);
		owner.addPet(second);
		owner.addPet(stored);
		assertEquals(List.of(first, second, stored), owner.getPets());
		assertNull(first.getId());
		assertNull(second.getId());
	}

	@Test
	void namesAtThirtyCharactersPassAndThirtyOneCharactersFail() {
		for (Integer id : new Integer[] { null, 42 }) {
			assertFalse(validate(pet(id, "a".repeat(30))).hasErrors());
			BeanPropertyBindingResult tooLong = validate(pet(id, "a".repeat(31)));
			assertTrue(tooLong.hasFieldErrors("name"));
			assertFalse(tooLong.hasFieldErrors("type"));
			assertFalse(tooLong.hasFieldErrors("birthDate"));
		}
	}

	@Test
	void missingAndBlankNamesKeepTheirRequiredValidation() {
		for (String name : new String[] { null, "", " \t " }) {
			BeanPropertyBindingResult errors = validate(pet(null, name));
			assertTrue(errors.hasFieldErrors("name"));
			assertEquals("required", errors.getFieldError("name").getCode());
		}
	}

	@Test
	void newPetTypeAndBirthDateRemainRequired() {
		Pet fresh = pet(null, "Fresh");
		fresh.setType(null);
		fresh.setBirthDate(null);
		BeanPropertyBindingResult errors = validate(fresh);
		assertFalse(errors.hasFieldErrors("name"));
		assertEquals("required", errors.getFieldError("type").getCode());
		assertEquals("required", errors.getFieldError("birthDate").getCode());
	}

	@Test
	void persistedPetWithoutTypeRetainsItsExistingValidationContract() {
		Pet stored = pet(42, "Stored");
		stored.setType(null);
		assertFalse(validate(stored).hasErrors());
	}

}
