import unittest
from unittest.mock import patch

from ai_service import AIServiceError, OLLAMA_MODEL
from adviser_recommendations import recommend_advisers


class AdviserRecommendationTests(unittest.TestCase):
    group = {"title": "Smart farm", "project_title": "Crop monitoring", "description": "IoT sensors"}
    advisers = [{"adviser_id": 10, "expertise": "IoT and embedded systems"}]
    match = {"adviser_id": 10, "reason": "IoT expertise fits crop sensors.", "evidence": "IoT"}

    @patch("adviser_recommendations.ask_json")
    def test_prompt_uses_context_and_schema_constrains_candidates(self, ask):
        ask.return_value = {"recommendations": [self.match]}
        self.assertEqual(recommend_advisers(self.group, self.advisers)["recommendations"], [self.match])
        self.assertEqual(OLLAMA_MODEL, "llama3.2:1b")
        self.assertNotIn("model", ask.call_args.kwargs)
        self.assertIn("untrusted data", ask.call_args.args[0])
        self.assertIn("Crop monitoring", ask.call_args.args[1])
        fields = ask.call_args.kwargs["response_schema"]["properties"]["recommendations"]["items"]["properties"]
        self.assertEqual(fields["adviser_id"]["enum"], [10])
        self.assertEqual(fields["evidence"]["enum"], ["IoT and embedded systems"])

    @patch("adviser_recommendations.ask_json")
    def test_rejects_invented_ids_evidence_and_duplicates(self, ask):
        ask.return_value = {"recommendations": [None, {**self.match, "adviser_id": 99},
            {**self.match, "adviser_id": True}, {**self.match, "evidence": "Robotics"}, self.match, self.match]}
        self.assertEqual(recommend_advisers(self.group, self.advisers)["recommendations"], [self.match])

    @patch("adviser_recommendations.ask_json")
    def test_invalid_output_is_error_empty_matches_valid(self, ask):
        for result in [{}, {"recommendations": [{**self.match, "evidence": "Invented"}]}]:
            ask.return_value = result
            with self.assertRaises(AIServiceError):
                recommend_advisers(self.group, self.advisers)
        ask.return_value = {"recommendations": []}
        self.assertEqual(recommend_advisers(self.group, self.advisers), {"recommendations": []})

    def test_endpoint_auth_and_request_limits(self):
        import main
        from fastapi.testclient import TestClient
        client = TestClient(main.app)
        payload = {"group": self.group, "advisers": self.advisers}
        with patch.object(main, "AI_SERVICE_TOKEN", "test-only"):
            self.assertEqual(client.post("/recommend-advisers", json=payload).status_code, 401)
            headers = {"x-ai-service-token": "test-only"}
            with patch.object(main, "recommend_advisers", return_value={"recommendations": [self.match]}):
                self.assertEqual(client.post("/recommend-advisers", json=payload, headers=headers).status_code, 200)
            payload["advisers"] = self.advisers * 13
            self.assertEqual(client.post("/recommend-advisers", json=payload, headers=headers).status_code, 422)


if __name__ == "__main__":
    unittest.main()
