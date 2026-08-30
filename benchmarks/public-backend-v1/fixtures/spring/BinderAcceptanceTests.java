package org.springframework.samples.petclinic.owner;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.format.support.DefaultFormattingConversionService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Evaluator-owned HTTP binding checks; repositories are mocks, not databases. */
class BinderAcceptanceTests {

	private OwnerRepository repository;

	private Owner owner;

	private Pet pet;

	private PetType cat;

	private MockMvc mvc;

	@BeforeEach
	void setup() {
		repository = mock(OwnerRepository.class);
		PetTypeRepository types = mock(PetTypeRepository.class);
		cat = new PetType();
		cat.setId(3);
		cat.setName("cat");
		owner = new Owner();
		owner.setId(1);
		owner.setFirstName("Original");
		owner.setLastName("Owner");
		owner.setAddress("Initial street");
		owner.setCity("Initial city");
		owner.setTelephone("1234567890");
		pet = new Pet();
		pet.setName("Original pet");
		pet.setType(cat);
		pet.setBirthDate(LocalDate.of(2010, 1, 1));
		owner.addPet(pet);
		pet.setId(2);
		when(repository.findById(1)).thenReturn(Optional.of(owner));
		when(types.findPetTypes()).thenReturn(List.of(cat));
		DefaultFormattingConversionService conversion = new DefaultFormattingConversionService();
		conversion.addFormatter(new PetTypeFormatter(types));
		mvc = MockMvcBuilders
			.standaloneSetup(new OwnerController(repository), new PetController(repository, types),
					new VisitController(repository))
			.setConversionService(conversion)
			.build();
	}

	@Test
	void ownerRequestRejectsDirectAndNestedIdsButBindsMutableFields() throws Exception {
		mvc.perform(post("/owners/1/edit").param("id", "999")
			.param("pets[0].id", "888")
			.param("pets[0].type.id", "777")
			.param("firstName", "Updated")
			.param("lastName", "Person")
			.param("address", "Changed street")
			.param("city", "Changed city")
			.param("telephone", "0987654321")).andExpect(status().is3xxRedirection());
		assertEquals(1, owner.getId());
		assertEquals(2, pet.getId());
		assertEquals(3, cat.getId());
		assertEquals("Updated", owner.getFirstName());
		assertEquals("Person", owner.getLastName());
		assertEquals("Changed street", owner.getAddress());
		assertEquals("Changed city", owner.getCity());
		assertEquals("0987654321", owner.getTelephone());
		verify(repository).save(owner);
	}

	@Test
	void petRequestRejectsDirectAndNestedIdsButBindsMutableFields() throws Exception {
		mvc.perform(post("/owners/1/pets/2/edit").param("id", "999")
			.param("pets[0].id", "888")
			.param("type.id", "777")
			.param("name", "Updated pet")
			.param("birthDate", "2012-03-04")).andExpect(status().is3xxRedirection());
		assertEquals(1, owner.getId());
		assertEquals(2, pet.getId());
		assertEquals(3, cat.getId());
		assertEquals("Updated pet", pet.getName());
		assertEquals(LocalDate.of(2012, 3, 4), pet.getBirthDate());
		verify(repository).save(owner);
	}

	@Test
	void visitRequestRejectsDirectAndNestedIdsButBindsDescription() throws Exception {
		mvc.perform(post("/owners/1/pets/2/visits/new").param("id", "999")
			.param("pets[0].id", "888")
			.param("pets[0].type.id", "777")
			.param("date", LocalDate.now().plusDays(2).toString())
			.param("description", "Routine visit")).andExpect(status().is3xxRedirection());
		assertEquals(1, owner.getId());
		assertEquals(2, pet.getId());
		assertEquals(3, cat.getId());
		assertEquals(1, pet.getVisits().size());
		Visit visit = pet.getVisits().iterator().next();
		assertNull(visit.getId());
		assertEquals("Routine visit", visit.getDescription());
		assertEquals(LocalDate.now().plusDays(2), visit.getDate());
		verify(repository).save(owner);
	}

	@Test
	void petNameValidationRemainsActive() throws Exception {
		mvc.perform(post("/owners/1/pets/2/edit").param("name", "").param("birthDate", "2012-03-04"))
			.andExpect(status().isOk())
			.andExpect(model().attributeHasFieldErrors("pet", "name"));
		verify(repository, never()).save(any(Owner.class));
	}

	@Test
	void petTypeValidationRemainsActive() throws Exception {
		mvc.perform(post("/owners/1/pets/new").param("name", "New pet").param("birthDate", "2012-03-04"))
			.andExpect(status().isOk())
			.andExpect(model().attributeHasFieldErrors("pet", "type"));
		verify(repository, never()).save(any(Owner.class));
	}

}
