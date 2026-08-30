package org.springframework.samples.petclinic.owner;

import java.time.LocalDate;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.web.servlet.mvc.support.RedirectAttributesModelMap;

import static org.junit.jupiter.api.Assertions.*;

/** Evaluator-owned real JPA/H2 checks. Each test transaction rolls back. */
@DataJpaTest(properties = { "spring.datasource.url=jdbc:h2:mem:bth-pet-update;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
		"spring.datasource.username=sa", "spring.datasource.password=",
		"spring.datasource.driver-class-name=org.h2.Driver", "spring.sql.init.mode=always",
		"spring.sql.init.schema-locations=classpath:db/h2/schema.sql",
		"spring.sql.init.data-locations=classpath:db/h2/data.sql" })
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class PetUpdateAcceptanceTests {

	@Autowired
	private OwnerRepository repository;

	@Autowired
	private EntityManager entityManager;

	private Pet request(Integer id, String name, LocalDate date, PetType type) {
		Pet pet = new Pet();
		pet.setId(id);
		pet.setName(name);
		pet.setBirthDate(date);
		pet.setType(type);
		return pet;
	}

	private String update(Owner owner, Pet pet, BeanPropertyBindingResult errors) {
		return new PetController(repository).processUpdateForm(owner, pet, errors, new RedirectAttributesModelMap());
	}

	private Owner reload(int ownerId) {
		entityManager.flush();
		entityManager.clear();
		return repository.findById(ownerId).orElseThrow();
	}

	@Test
	void persistsExistingPetFieldsWithoutAddingDuplicate() {
		Owner owner = repository.findById(1).orElseThrow();
		Pet original = owner.getPets().get(0);
		int petId = original.getId();
		int count = owner.getPets().size();
		PetType replacementType = repository.findPetTypes()
			.stream()
			.filter(type -> !type.getId().equals(original.getType().getId()))
			.findFirst()
			.orElseThrow();
		int typeId = replacementType.getId();
		Pet changed = request(petId, "V24 renamed", LocalDate.of(2014, 2, 3), replacementType);
		BeanPropertyBindingResult errors = new BeanPropertyBindingResult(changed, "pet");
		assertEquals("redirect:/owners/{ownerId}", update(owner, changed, errors));
		assertFalse(errors.hasErrors());
		Owner stored = reload(owner.getId());
		assertEquals(count, stored.getPets().size());
		Pet saved = stored.getPet(petId);
		assertNotNull(saved);
		assertEquals("V24 renamed", saved.getName());
		assertEquals(LocalDate.of(2014, 2, 3), saved.getBirthDate());
		assertEquals(typeId, saved.getType().getId());
	}

	@Test
	void preservesFallbackForNewUnassociatedPet() {
		Owner owner = repository.findById(1).orElseThrow();
		int count = owner.getPets().size();
		Pet pet = request(null, "V24 new pet", LocalDate.of(2015, 4, 5), repository.findPetTypes().iterator().next());
		BeanPropertyBindingResult errors = new BeanPropertyBindingResult(pet, "pet");
		assertEquals("redirect:/owners/{ownerId}", update(owner, pet, errors));
		assertFalse(errors.hasErrors());
		Owner stored = reload(owner.getId());
		assertEquals(count + 1, stored.getPets().size());
		Pet saved = stored.getPet("V24 new pet");
		assertNotNull(saved);
		assertNotNull(saved.getId());
		assertEquals(LocalDate.of(2015, 4, 5), saved.getBirthDate());
	}

	@Test
	void duplicateNameDoesNotChangeStoredPet() {
		Owner owner = repository.findById(3).orElseThrow();
		assertTrue(owner.getPets().size() >= 2, "Fixture owner must have two distinct pets");
		Pet original = owner.getPets().get(0);
		int petId = original.getId();
		String oldName = original.getName();
		Pet pet = request(petId, owner.getPets().get(1).getName(), original.getBirthDate(), original.getType());
		BeanPropertyBindingResult errors = new BeanPropertyBindingResult(pet, "pet");
		assertEquals("pets/createOrUpdatePetForm", update(owner, pet, errors));
		assertTrue(errors.hasFieldErrors("name"));
		assertEquals(oldName, reload(owner.getId()).getPet(petId).getName());
	}

	@Test
	void futureBirthDateDoesNotChangeStoredPet() {
		Owner owner = repository.findById(1).orElseThrow();
		Pet original = owner.getPets().get(0);
		int petId = original.getId();
		LocalDate oldDate = original.getBirthDate();
		Pet pet = request(petId, original.getName(), LocalDate.now().plusDays(1), original.getType());
		BeanPropertyBindingResult errors = new BeanPropertyBindingResult(pet, "pet");
		assertEquals("pets/createOrUpdatePetForm", update(owner, pet, errors));
		assertTrue(errors.hasFieldErrors("birthDate"));
		assertEquals(oldDate, reload(owner.getId()).getPet(petId).getBirthDate());
	}

}
