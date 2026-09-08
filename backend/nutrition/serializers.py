from rest_framework import serializers

from .models import Food, FoodLogEntry, NutritionPlan


class FoodSerializer(serializers.ModelSerializer):
    is_custom = serializers.BooleanField(read_only=True)

    class Meta:
        model = Food
        fields = [
            "id", "name", "slug", "brand", "is_custom",
            "energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g",
            "serving_size_g", "serving_label",
        ]
        # slug is derived from the name server-side, per academy.
        read_only_fields = ["id", "slug", "is_custom"]


class NutritionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = NutritionPlan
        fields = [
            "id", "name", "target_kcal",
            "target_protein_g", "target_carbs_g", "target_fat_g",
        ]
        read_only_fields = ["id"]


class FoodLogEntrySerializer(serializers.ModelSerializer):
    food = FoodSerializer(read_only=True)
    food_id = serializers.PrimaryKeyRelatedField(
        queryset=Food.objects.all(), source="food", write_only=True
    )

    energy_kcal = serializers.DecimalField(max_digits=8, decimal_places=1, read_only=True)
    protein_g = serializers.DecimalField(max_digits=7, decimal_places=1, read_only=True)
    carbs_g = serializers.DecimalField(max_digits=7, decimal_places=1, read_only=True)
    fat_g = serializers.DecimalField(max_digits=7, decimal_places=1, read_only=True)

    class Meta:
        model = FoodLogEntry
        fields = [
            "id", "food", "food_id", "amount_g", "meal", "consumed_on",
            "energy_kcal", "protein_g", "carbs_g", "fat_g",
        ]
        read_only_fields = ["id", "energy_kcal", "protein_g", "carbs_g", "fat_g"]

    def validate_food_id(self, value):
        academy = self.context["academy"]
        if not Food.objects.visible_to(academy).filter(pk=value.pk).exists():
            raise serializers.ValidationError("That food is not available to this academy.")
        return value

    def validate_amount_g(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value
